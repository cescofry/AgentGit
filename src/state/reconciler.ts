import { Logger } from "../utils/logger"
import { createStateManager, OctokitLike } from "./manager"
import { AgentState, Trigger } from "./transitions"
import { createBlockedComment } from "../github/comments"
import { parseCommand } from "../commands/parser"
import { parseMetadataComment, hasMetadata, createMetadataComment } from "../utils/metadata"
import { loadConfig } from "../config/loader"
import { processCommandComment, processReadyIssue, processMergedAgentPr } from "../index"
import type { HandlerDeps } from "../commands/handlers"

// ── Poller config ──

export interface PollerConfig {
  intervalMs: number // default 30 * 1000 (30 seconds)
  staleThresholdMs: number // default 30 * 60 * 1000 (30 minutes)
  appSlug: string
  signingSecret: string
  workerId: string
  deps: HandlerDeps
}

export interface PollResult {
  reposScanned: number
  issuesChecked: number
  commandsProcessed: number
  issuesRecovered: number
  prsProcessed: number
  errors: string[]
}

export interface Poller {
  /** Run one full poll pass. */
  poll(): Promise<PollResult>

  /** Start periodic polling. */
  start(): void

  /** Stop periodic polling. */
  stop(): void

  /** Check if running. */
  isRunning(): boolean
}

// ── Stale recovery (was the old reconciler) ──

const STALE_CANDIDATE_LABELS: AgentState[] = [
  "agent:planning",
  "agent:working",
  "agent:approved",
  "agent:security-review",
]

const STALE_TRIGGER_MAP: Record<string, Trigger> = {
  "agent:planning": "plan_failed",
  "agent:working": "build_failed",
  "agent:approved": "stop_requested",
  "agent:security-review": "stop_requested",
}

// ── Extended Octokit interface ──

export interface PollerOctokit extends OctokitLike {
  rest: OctokitLike["rest"] & {
    apps: {
      listInstallations: (params?: {
        per_page?: number
        page?: number
      }) => Promise<{ data: Array<{ id: number; account?: { login: string } }> }>
      listReposAccessibleToInstallation: (params?: {
        per_page?: number
        page?: number
      }) => Promise<{
        data: { repositories: Array<{ owner: { login: string }; name: string }> }
      }>
    }
    issues: OctokitLike["rest"]["issues"] & {
      listForRepo: (params: {
        owner: string
        repo: string
        labels?: string
        state: string
        per_page?: number
        sort?: string
        direction?: string
        since?: string
      }) => Promise<{
        data: Array<{
          number: number
          title: string
          body: string
          updated_at: string
          labels: Array<{ name: string } | string>
        }>
      }>
      listComments: (params: {
        owner: string
        repo: string
        issue_number: number
        per_page?: number
        direction?: string
        since?: string
      }) => Promise<{
        data: Array<{
          id: number
          body?: string
          created_at: string
          user?: { login: string; type: string }
          performed_via_github_app?: { slug: string } | null
        }>
      }>
      createComment: (params: {
        owner: string
        repo: string
        issue_number: number
        body: string
      }) => Promise<unknown>
    }
    pulls?: {
      list: (params: {
        owner: string
        repo: string
        state: string
        per_page?: number
        sort?: string
        direction?: string
      }) => Promise<{
        data: Array<{
          number: number
          merged: boolean
          merged_at?: string
          user: { login: string; type: string }
          body: string
          head: { ref: string }
        }>
      }>
    }
  }
}

// Keep the old type alias for backwards compatibility with existing tests
export type ReconcilerOctokit = PollerOctokit
export type ReconcilerConfig = PollerConfig

/**
 * Create and return a poller that periodically scans GitHub for:
 * 1. New /agent command comments (unprocessed)
 * 2. Issues with agent:ready label (not yet started)
 * 3. Merged PRs created by AgentGit
 * 4. Stale issues that need recovery
 *
 * This is the primary event driver -- no inbound webhooks needed.
 */
export function createPoller(
  getOctokit: () => PollerOctokit,
  config: PollerConfig,
  logger: Logger,
): Poller {
  let intervalHandle: ReturnType<typeof setInterval> | null = null
  const stateManager = createStateManager()

  // ── Command receipt helpers ──

  /**
   * Check if a command comment has already been processed by looking for
   * a receipt comment referencing this comment ID.
   */
  function isCommandProcessed(
    comments: Array<{ id: number; body?: string; performed_via_github_app?: { slug: string } | null }>,
    commandCommentId: number,
  ): boolean {
    for (const c of comments) {
      if (c.performed_via_github_app?.slug !== config.appSlug) continue
      if (!c.body) continue
      const parsed = parseMetadataComment(c.body)
      if (!parsed) continue
      const meta = parsed.metadata as any
      if (meta.type === "processed-command" && meta.comment_id === commandCommentId) {
        return true
      }
    }
    return false
  }

  /**
   * Post a signed receipt comment indicating a command was processed.
   */
  async function postReceipt(
    octokit: PollerOctokit,
    owner: string,
    repo: string,
    issueNumber: number,
    commentId: number,
    command: string,
  ): Promise<void> {
    const metadata = {
      type: "processed-command",
      comment_id: commentId,
      command,
      worker_id: config.workerId,
      processed_at: new Date().toISOString(),
    }
    const body = createMetadataComment(
      metadata,
      `Command \`${command}\` processed.`,
      config.signingSecret,
    )
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body,
    })
  }

  // ── Stale issue recovery ──

  async function getLastBotCommentTime(
    octokit: PollerOctokit,
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<Date | null> {
    const { data: comments } = await octokit.rest.issues.listComments({
      owner,
      repo,
      issue_number: issueNumber,
      per_page: 100,
      direction: "desc",
    })

    for (const comment of comments) {
      if (comment.performed_via_github_app?.slug === config.appSlug) {
        return new Date(comment.created_at)
      }
    }

    return null
  }

  function isStale(lastBotComment: Date | null, issueUpdatedAt: string, now: Date): boolean {
    const reference = lastBotComment ?? new Date(issueUpdatedAt)
    return now.getTime() - reference.getTime() > config.staleThresholdMs
  }

  async function recoverIssue(
    octokit: PollerOctokit,
    owner: string,
    repo: string,
    issueNumber: number,
    currentState: AgentState,
  ): Promise<boolean> {
    const trigger = STALE_TRIGGER_MAP[currentState as string]
    if (!trigger) return false

    const result = await stateManager.transition(
      octokit,
      owner,
      repo,
      issueNumber,
      trigger,
    )

    if (!result.valid) {
      logger.warn("Poller stale recovery transition rejected", {
        owner, repo, issue: issueNumber, from: currentState, trigger, reason: result.reason,
      })
      return false
    }

    const phaseMap: Record<string, string> = {
      "agent:planning": "planning",
      "agent:working": "build",
      "agent:approved": "execution-start",
      "agent:security-review": "security-review",
    }
    const failedPhase = phaseMap[currentState as string] ?? "unknown"

    const commentBody = createBlockedComment(
      issueNumber,
      `Issue timed out in \`${currentState}\` state (no activity for ${Math.round(config.staleThresholdMs / 60000)} minutes). Moved to recovery state by poller.`,
      failedPhase,
      config.signingSecret,
    )

    await octokit.rest.issues.createComment({
      owner, repo, issue_number: issueNumber, body: commentBody,
    })

    logger.info("Poller recovered stale issue", {
      owner, repo, issue: issueNumber, from: currentState, to: result.to,
    })

    return true
  }

  // ── Scan functions ──

  /**
   * Scan a repo for unprocessed /agent command comments.
   */
  async function scanRepoForCommands(
    octokit: PollerOctokit,
    owner: string,
    repo: string,
  ): Promise<{ processed: number; errors: string[] }> {
    let processed = 0
    const errors: string[] = []

    try {
      // Get open issues that have any agent label or could have commands
      const { data: issues } = await octokit.rest.issues.listForRepo({
        owner, repo, state: "open", per_page: 100, sort: "updated", direction: "desc",
      })

      for (const issue of issues) {
        try {
          const { data: comments } = await octokit.rest.issues.listComments({
            owner, repo, issue_number: issue.number, per_page: 100, direction: "asc",
          })

          for (const comment of comments) {
            if (!comment.body) continue
            const cmd = parseCommand(comment.body)
            if (!cmd) continue

            // Skip bot's own comments
            if (comment.performed_via_github_app?.slug === config.appSlug) continue
            if (comment.user?.type === "Bot") continue

            // Check if already processed
            if (isCommandProcessed(comments, comment.id)) continue

            // Process the command
            try {
              const wasProcessed = await processCommandComment(
                octokit, owner, repo, issue,
                { id: comment.id, body: comment.body, user: comment.user! },
                config.deps,
              )

              if (wasProcessed) {
                await postReceipt(octokit, owner, repo, issue.number, comment.id, cmd.action)
                processed++
              }
            } catch (err: any) {
              const msg = `Failed to process command on ${owner}/${repo}#${issue.number} comment ${comment.id}: ${err.message}`
              logger.error(msg)
              errors.push(msg)
            }
          }
        } catch (err: any) {
          const msg = `Failed to scan comments for ${owner}/${repo}#${issue.number}: ${err.message}`
          logger.error(msg)
          errors.push(msg)
        }
      }
    } catch (err: any) {
      const msg = `Failed to list issues for ${owner}/${repo}: ${err.message}`
      logger.error(msg)
      errors.push(msg)
    }

    return { processed, errors }
  }

  /**
   * Scan a repo for issues with ready labels that haven't been started yet.
   */
  async function scanRepoForReadyIssues(
    octokit: PollerOctokit,
    owner: string,
    repo: string,
  ): Promise<{ processed: number; errors: string[] }> {
    let processed = 0
    const errors: string[] = []

    try {
      const { config: repoConfig } = await loadConfig(octokit as any, owner, repo)
      if (!repoConfig.enabled) return { processed, errors }

      const readyLabels = repoConfig.ready_labels || ["agent:ready"]

      for (const readyLabel of readyLabels) {
        try {
          const { data: issues } = await octokit.rest.issues.listForRepo({
            owner, repo, labels: readyLabel, state: "open", per_page: 100,
          })

          for (const issue of issues) {
            const labelNames = issue.labels.map((l) => typeof l === "string" ? l : l.name)

            // Skip if already in an active agent state (not just ready)
            const hasActiveState = labelNames.some((l) =>
              l.startsWith("agent:") && l !== "agent:ready" &&
              !l.startsWith("agent:type:") && l !== "agent:needs-admin" &&
              l !== "agent:needs-info" && l !== "agent:retryable",
            )
            if (hasActiveState) continue

            try {
              await processReadyIssue(octokit, owner, repo, issue, config.deps, repoConfig)
              processed++
            } catch (err: any) {
              const msg = `Failed to process ready issue ${owner}/${repo}#${issue.number}: ${err.message}`
              logger.error(msg)
              errors.push(msg)
            }
          }
        } catch (err: any) {
          const msg = `Failed to list ready issues for ${owner}/${repo} label=${readyLabel}: ${err.message}`
          logger.error(msg)
          errors.push(msg)
        }
      }
    } catch (err: any) {
      errors.push(`Failed to load config for ${owner}/${repo}: ${err.message}`)
    }

    return { processed, errors }
  }

  /**
   * Scan a repo for merged PRs created by AgentGit.
   */
  async function scanRepoForMergedPrs(
    octokit: PollerOctokit,
    owner: string,
    repo: string,
  ): Promise<{ processed: number; errors: string[] }> {
    let processed = 0
    const errors: string[] = []

    if (!octokit.rest.pulls) return { processed, errors }

    try {
      const { config: repoConfig } = await loadConfig(octokit as any, owner, repo)
      if (!repoConfig.enabled) return { processed, errors }

      const { data: prs } = await octokit.rest.pulls.list({
        owner, repo, state: "closed", per_page: 30, sort: "updated", direction: "desc",
      })

      for (const pr of prs) {
        if (!pr.merged) continue
        if (!pr.body) continue

        try {
          await processMergedAgentPr(octokit, owner, repo, pr, config.deps, repoConfig)
          processed++
        } catch (err: any) {
          const msg = `Failed to process merged PR ${owner}/${repo}#${pr.number}: ${err.message}`
          logger.error(msg)
          errors.push(msg)
        }
      }
    } catch (err: any) {
      const msg = `Failed to scan PRs for ${owner}/${repo}: ${err.message}`
      logger.error(msg)
      errors.push(msg)
    }

    return { processed, errors }
  }

  /**
   * Scan a repo for stale issues and recover them.
   */
  async function scanRepoForStaleIssues(
    octokit: PollerOctokit,
    owner: string,
    repo: string,
    now: Date,
  ): Promise<{ checked: number; recovered: number; errors: string[] }> {
    let checked = 0
    let recovered = 0
    const errors: string[] = []

    for (const label of STALE_CANDIDATE_LABELS) {
      if (label === null) continue

      let issues: Array<{
        number: number
        updated_at: string
        labels: Array<{ name: string } | string>
      }>

      try {
        const response = await octokit.rest.issues.listForRepo({
          owner, repo, labels: label, state: "open", per_page: 100,
        })
        issues = response.data
      } catch (err: any) {
        const msg = `Failed to list issues for ${owner}/${repo} label=${label}: ${err.message}`
        logger.error(msg)
        errors.push(msg)
        continue
      }

      for (const issue of issues) {
        checked++

        try {
          const labelNames = issue.labels.map((l) =>
            typeof l === "string" ? l : l.name,
          )
          if (!labelNames.includes(label)) continue
          if (labelNames.includes("agent:blocked")) continue

          const lastBotComment = await getLastBotCommentTime(
            octokit, owner, repo, issue.number,
          )

          if (isStale(lastBotComment, issue.updated_at, now)) {
            const didRecover = await recoverIssue(
              octokit, owner, repo, issue.number, label,
            )
            if (didRecover) {
              recovered++
            }
          }
        } catch (err: any) {
          const msg = `Failed to process issue ${owner}/${repo}#${issue.number}: ${err.message}`
          logger.error(msg)
          errors.push(msg)
        }
      }
    }

    return { checked, recovered, errors }
  }

  // ── Main poll pass ──

  async function poll(): Promise<PollResult> {
    const result: PollResult = {
      reposScanned: 0,
      issuesChecked: 0,
      commandsProcessed: 0,
      issuesRecovered: 0,
      prsProcessed: 0,
      errors: [],
    }

    const octokit = getOctokit()
    const now = new Date()

    let installations: Array<{ id: number }>
    try {
      const response = await octokit.rest.apps.listInstallations({ per_page: 100 })
      installations = response.data
    } catch (err: any) {
      const msg = `Failed to list installations: ${err.message}`
      logger.error(msg)
      result.errors.push(msg)
      return result
    }

    for (const installation of installations) {
      let repos: Array<{ owner: { login: string }; name: string }>
      try {
        const response = await octokit.rest.apps.listReposAccessibleToInstallation({
          per_page: 100,
        })
        repos = response.data.repositories
      } catch (err: any) {
        const msg = `Failed to list repos for installation ${installation.id}: ${err.message}`
        logger.error(msg)
        result.errors.push(msg)
        continue
      }

      for (const repoInfo of repos) {
        result.reposScanned++
        const owner = repoInfo.owner.login
        const repo = repoInfo.name

        // 1. Scan for new commands
        const cmdResult = await scanRepoForCommands(octokit, owner, repo)
        result.commandsProcessed += cmdResult.processed
        result.errors.push(...cmdResult.errors)

        // 2. Scan for ready issues
        const readyResult = await scanRepoForReadyIssues(octokit, owner, repo)
        result.commandsProcessed += readyResult.processed
        result.errors.push(...readyResult.errors)

        // 3. Scan for merged PRs
        const prResult = await scanRepoForMergedPrs(octokit, owner, repo)
        result.prsProcessed += prResult.processed
        result.errors.push(...prResult.errors)

        // 4. Scan for stale issues
        const staleResult = await scanRepoForStaleIssues(octokit, owner, repo, now)
        result.issuesChecked += staleResult.checked
        result.issuesRecovered += staleResult.recovered
        result.errors.push(...staleResult.errors)
      }
    }

    logger.info("Poll pass complete", {
      reposScanned: result.reposScanned,
      commandsProcessed: result.commandsProcessed,
      issuesRecovered: result.issuesRecovered,
      prsProcessed: result.prsProcessed,
      errorCount: result.errors.length,
    })

    return result
  }

  return {
    poll,

    start(): void {
      if (intervalHandle !== null) return
      logger.info("Poller started", { intervalMs: config.intervalMs, workerId: config.workerId })
      intervalHandle = setInterval(() => {
        poll().catch((err) => {
          logger.error("Poll pass failed", { error: err.message })
        })
      }, config.intervalMs)
    },

    stop(): void {
      if (intervalHandle === null) return
      clearInterval(intervalHandle)
      intervalHandle = null
      logger.info("Poller stopped")
    },

    isRunning(): boolean {
      return intervalHandle !== null
    },
  }
}

// ── Backwards compatibility aliases ──

/** @deprecated Use createPoller instead */
export const createReconciler = createPoller
export type Reconciler = Poller
export type ReconcilerResult = PollResult
