import { Logger } from "../utils/logger"
import { createStateManager, OctokitLike } from "./manager"
import { AgentState, Trigger } from "./transitions"
import { createBlockedComment } from "../github/comments"

export interface ReconcilerConfig {
  intervalMs: number // default 10 * 60 * 1000 (10 minutes)
  staleThresholdMs: number // default 30 * 60 * 1000 (30 minutes)
  appSlug: string
  signingSecret: string
}

export interface ReconcilerResult {
  reposScanned: number
  issuesChecked: number
  issuesRecovered: number
  errors: string[]
}

export interface Reconciler {
  /** Run one reconciliation pass. */
  reconcile(): Promise<ReconcilerResult>

  /** Start periodic reconciliation. */
  start(): void

  /** Stop periodic reconciliation. */
  stop(): void

  /** Check if running. */
  isRunning(): boolean
}

/**
 * The set of agent states that indicate active processing and should be
 * checked for staleness. Terminal / waiting-for-human states like
 * agent:blocked, agent:done, agent:cancelled, agent:plan-review,
 * agent:locked-security, and agent:pr-opened are excluded.
 */
const STALE_CANDIDATE_LABELS: AgentState[] = [
  "agent:planning",
  "agent:working",
  "agent:approved",
  "agent:security-review",
]

/**
 * Map each stale-candidate state to the trigger that transitions it to blocked.
 * The state machine already defines these transitions:
 *   planning  -> plan_failed -> blocked
 *   working   -> build_failed -> blocked
 *   approved  -> (no direct blocked trigger, so we use stop_requested -> cancelled)
 *   security-review -> (no direct blocked trigger, use stop_requested -> cancelled)
 *
 * For reconciler recovery we want all stale issues to end up blocked so an admin
 * can decide what to do. We use plan_failed / build_failed where the transition
 * table supports it, and fall back to stop_requested for states that lack a
 * direct-to-blocked path.
 */
const STALE_TRIGGER_MAP: Record<string, Trigger> = {
  "agent:planning": "plan_failed",
  "agent:working": "build_failed",
  "agent:approved": "stop_requested",
  "agent:security-review": "stop_requested",
}

/**
 * Extended Octokit interface that adds the apps and search namespaces needed
 * by the reconciler (on top of the base OctokitLike).
 */
export interface ReconcilerOctokit extends OctokitLike {
  rest: OctokitLike["rest"] & {
    apps: {
      listInstallations: (params?: {
        per_page?: number
        page?: number
      }) => Promise<{ data: Array<{ id: number }> }>
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
        labels: string
        state: string
        per_page?: number
      }) => Promise<{
        data: Array<{
          number: number
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
      }) => Promise<{
        data: Array<{
          id: number
          body?: string
          created_at: string
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
  }
}

/**
 * Create and return a reconciler that periodically scans for stale issues
 * and transitions them to a recovery state.
 */
export function createReconciler(
  getOctokit: () => ReconcilerOctokit,
  config: ReconcilerConfig,
  logger: Logger,
): Reconciler {
  let intervalHandle: ReturnType<typeof setInterval> | null = null
  const stateManager = createStateManager()

  /**
   * Find the timestamp of the last comment posted by our app on an issue.
   * Returns null if no app comment is found.
   */
  async function getLastBotCommentTime(
    octokit: ReconcilerOctokit,
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

  /**
   * Determine whether an issue is stale based on bot comment age or
   * the issue's updated_at timestamp.
   */
  function isStale(lastBotComment: Date | null, issueUpdatedAt: string, now: Date): boolean {
    const reference = lastBotComment ?? new Date(issueUpdatedAt)
    return now.getTime() - reference.getTime() > config.staleThresholdMs
  }

  /**
   * Recover a single stale issue by transitioning it and posting a comment.
   */
  async function recoverIssue(
    octokit: ReconcilerOctokit,
    owner: string,
    repo: string,
    issueNumber: number,
    currentState: AgentState,
  ): Promise<boolean> {
    const trigger = STALE_TRIGGER_MAP[currentState as string]
    if (!trigger) {
      return false
    }

    const result = await stateManager.transition(
      octokit,
      owner,
      repo,
      issueNumber,
      trigger,
    )

    if (!result.valid) {
      logger.warn("Reconciler transition rejected", {
        owner,
        repo,
        issue: issueNumber,
        from: currentState,
        trigger,
        reason: result.reason,
      })
      return false
    }

    // Determine the phase name for the blocked comment
    const phaseMap: Record<string, string> = {
      "agent:planning": "planning",
      "agent:working": "build",
      "agent:approved": "execution-start",
      "agent:security-review": "security-review",
    }
    const failedPhase = phaseMap[currentState as string] ?? "unknown"

    const commentBody = createBlockedComment(
      issueNumber,
      `Issue timed out in \`${currentState}\` state (no activity for ${Math.round(config.staleThresholdMs / 60000)} minutes). Moved to recovery state by reconciler.`,
      failedPhase,
      config.signingSecret,
    )

    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: commentBody,
    })

    logger.info("Reconciler recovered stale issue", {
      owner,
      repo,
      issue: issueNumber,
      from: currentState,
      to: result.to,
    })

    return true
  }

  /**
   * Scan a single repo for stale issues and recover them.
   */
  async function scanRepo(
    octokit: ReconcilerOctokit,
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
          owner,
          repo,
          labels: label,
          state: "open",
          per_page: 100,
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
          // Verify the issue actually has this state label (API filtering can be loose)
          const labelNames = issue.labels.map((l) =>
            typeof l === "string" ? l : l.name,
          )
          if (!labelNames.includes(label)) continue

          // Skip if already blocked
          if (labelNames.includes("agent:blocked")) continue

          const lastBotComment = await getLastBotCommentTime(
            octokit,
            owner,
            repo,
            issue.number,
          )

          if (isStale(lastBotComment, issue.updated_at, now)) {
            const didRecover = await recoverIssue(
              octokit,
              owner,
              repo,
              issue.number,
              label,
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

  /**
   * Run one full reconciliation pass across all installed repos.
   */
  async function reconcile(): Promise<ReconcilerResult> {
    const result: ReconcilerResult = {
      reposScanned: 0,
      issuesChecked: 0,
      issuesRecovered: 0,
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

        const scanResult = await scanRepo(
          octokit,
          repoInfo.owner.login,
          repoInfo.name,
          now,
        )

        result.issuesChecked += scanResult.checked
        result.issuesRecovered += scanResult.recovered
        result.errors.push(...scanResult.errors)
      }
    }

    logger.info("Reconciliation pass complete", {
      reposScanned: result.reposScanned,
      issuesChecked: result.issuesChecked,
      issuesRecovered: result.issuesRecovered,
      errorCount: result.errors.length,
    })

    return result
  }

  return {
    reconcile,

    start(): void {
      if (intervalHandle !== null) return
      logger.info("Reconciler started", { intervalMs: config.intervalMs })
      intervalHandle = setInterval(() => {
        reconcile().catch((err) => {
          logger.error("Reconciliation pass failed", { error: err.message })
        })
      }, config.intervalMs)
    },

    stop(): void {
      if (intervalHandle === null) return
      clearInterval(intervalHandle)
      intervalHandle = null
      logger.info("Reconciler stopped")
    },

    isRunning(): boolean {
      return intervalHandle !== null
    },
  }
}
