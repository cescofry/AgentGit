import dotenv from "dotenv"

import { parseCommand } from "./commands/parser"
import {
  buildIssueContext,
  handlePlan,
  handleApprove,
  handleRevise,
  handleRun,
  handleStop,
  handleRetry,
  handleStatus,
  handleDelegate,
  handleUndelegate,
  handleListDelegates,
  handleUnlockSecurity,
  handleCloseUnsafe,
  handleSecurityStatus,
  executePlanFlow,
  HandlerContext,
  HandlerDeps,
} from "./commands/handlers"
import { isAuthorized, AuthorizationContext } from "./github/auth"
import { getActiveDelegations } from "./github/delegation"
import { createStatusComment } from "./github/comments"
import { verifyPrProvenance } from "./github/pull-requests"
import { parseMetadataComment, hasMetadata, createMetadataComment } from "./utils/metadata"
import { createStateManager } from "./state/manager"
import { loadConfig } from "./config/loader"
import { createSkillRegistry } from "./skills/registry"
import { createLogger } from "./utils/logger"
import { TaskSafetyCheckerSkill } from "./security/checker"
import { IssueClassifierSkill } from "./skills/builtin/issue-classifier"
import { PlanGeneratorSkill } from "./skills/builtin/plan-generator"
import { PlanExecutorSkill } from "./skills/builtin/plan-executor"
import { WorkspaceSetupSkill } from "./skills/builtin/workspace-setup"
import { TestRunnerSkill } from "./skills/builtin/test-runner"
import { DocsCheckerSkill } from "./skills/builtin/docs-checker"
import { LintRunnerSkill } from "./skills/builtin/lint-runner"
import { PrCreatorSkill } from "./skills/builtin/pr-creator"
import { createPoller, Poller } from "./state/reconciler"

dotenv.config()

// ── Reusable event processors ──

/**
 * Process a single issue comment that may contain an /agent command.
 * Extracted from the old Probot webhook handler so it can be invoked
 * from the polling loop or any other driver.
 */
export async function processCommandComment(
  octokit: any,
  owner: string,
  repo: string,
  issue: any,
  comment: { id: number; body: string; user: { login: string; type: string } },
  deps: HandlerDeps,
): Promise<boolean> {
  const command = parseCommand(comment.body)
  if (!command) return false

  const { config } = await loadConfig(octokit, owner, repo)
  if (!config.enabled) return false

  const handlerCtx: HandlerContext = {
    octokit,
    repo: () => ({ owner, repo }),
    issue: (data?: any) => ({ owner, repo, issue_number: issue.number, ...data }),
  }

  // Build auth context
  const authContext: AuthorizationContext = {
    senderLogin: comment.user.login,
    repoOwner: owner,
    repoName: repo,
    issueNumber: issue.number,
    requiredPermissions: config.approval.required_permissions as any,
    allowedUsers: config.approval.allowed_users,
    securityAdmins: config.security.security_admins,
    minDelegatePermission: config.approval.delegation.min_delegate_permission as any,
  }

  // Check authorization (with delegation support)
  const getDelegations = async (issueNum: number) => {
    const comments = await octokit.issues.listComments({
      owner,
      repo,
      issue_number: issueNum,
    })
    const delegations = getActiveDelegations(
      comments.data.map((c: any) => ({
        user: { login: c.user!.login, type: c.user!.type },
        body: c.body || "",
      })),
      deps.appSlug,
      deps.signingSecret,
      issueNum,
    )
    return delegations.map((d) => ({
      username: d.delegated_to,
      command: d.scopes.includes(command.action) ? command.action : "",
    }))
  }

  const authResult = await isAuthorized(
    octokit,
    command.action,
    authContext,
    getDelegations,
  )
  if (!authResult.authorized) {
    await octokit.issues.createComment({
      owner,
      repo,
      issue_number: issue.number,
      body: `@${comment.user.login} ${authResult.reason}`,
    })
    return true // processed but rejected
  }

  deps.logger.info(`Dispatching command: ${command.action}`, {
    sender: comment.user.login,
    issue: issue.number,
    repo: `${owner}/${repo}`,
  })

  switch (command.action) {
    case "plan":
      await handlePlan(handlerCtx, config, deps, issue)
      break
    case "approve":
      await handleApprove(handlerCtx, config, deps, issue, comment.user.login)
      break
    case "revise":
      await handleRevise(handlerCtx, config, deps, issue, command.args)
      break
    case "run":
      await handleRun(handlerCtx, config, deps, issue, comment.user.login)
      break
    case "stop":
      await handleStop(handlerCtx, deps, comment.user.login)
      break
    case "retry":
      await handleRetry(handlerCtx, config, deps, issue)
      break
    case "status":
      await handleStatus(handlerCtx, deps)
      break
    case "delegate":
      await handleDelegate(handlerCtx, deps, command.args, comment.user.login, issue)
      break
    case "undelegate":
      await handleUndelegate(handlerCtx, deps, command.args, comment.user.login, issue)
      break
    case "delegates":
      await handleListDelegates(handlerCtx, deps, issue)
      break
    case "unlock-security":
      await handleUnlockSecurity(handlerCtx, deps, config, issue, comment.user.login)
      break
    case "close-unsafe":
      await handleCloseUnsafe(handlerCtx, deps, comment.user.login)
      break
    case "security-status":
      await handleSecurityStatus(handlerCtx, deps)
      break
    default:
      deps.logger.warn(`Unknown command action: ${command.action}`)
  }

  return true
}

/**
 * Process a ready-label issue (equivalent to the old issues.labeled webhook).
 */
export async function processReadyIssue(
  octokit: any,
  owner: string,
  repo: string,
  issue: any,
  deps: HandlerDeps,
  config: any,
): Promise<void> {
  const handlerCtx: HandlerContext = {
    octokit,
    repo: () => ({ owner, repo }),
    issue: (data?: any) => ({ owner, repo, issue_number: issue.number, ...data }),
  }

  await handlePlan(handlerCtx, config, deps, issue)
}

/**
 * Process a merged PR that was created by AgentGit (equivalent to pull_request.closed webhook).
 */
export async function processMergedAgentPr(
  octokit: any,
  owner: string,
  repo: string,
  pr: any,
  deps: HandlerDeps,
  config: any,
): Promise<void> {
  if (!pr.merged) return

  const branchPrefix = config.execution.branch_prefix || "agent/"
  const provenance = verifyPrProvenance(
    {
      user: { login: pr.user.login, type: pr.user.type },
      body: pr.body || "",
      head: { ref: pr.head.ref },
    },
    deps.appSlug,
    branchPrefix,
    deps.signingSecret,
  )

  if (!provenance.valid) return

  const parsed = parseMetadataComment(pr.body || "")
  if (!parsed) return

  const metadata = parsed.metadata as Record<string, any>
  const issueNumber = metadata.issue_number
  if (!issueNumber) return

  deps.logger.info(`PR #${pr.number} merged for issue #${issueNumber}`, {
    repo: `${owner}/${repo}`,
  })

  await deps.stateManager.transition(
    octokit,
    owner,
    repo,
    issueNumber,
    "pr_merged",
  )

  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: createStatusComment("Completed", `PR #${pr.number} has been merged. Issue resolved.`),
  })
}

// ── App setup and startup ──

export function createAgentGitDeps(): HandlerDeps {
  const logLevel = (process.env.AGENTGIT_LOG_LEVEL as any) || "info"
  const logger = createLogger(logLevel, { component: "agentgit" })
  const stateManager = createStateManager()
  const signingSecret = process.env.AGENTGIT_SIGNING_SECRET || ""
  const appSlug = process.env.GITHUB_APP_SLUG || "agentgit"

  // Register built-in skills
  const skillRegistry = createSkillRegistry()
  skillRegistry.register(new TaskSafetyCheckerSkill())
  skillRegistry.register(new IssueClassifierSkill())
  skillRegistry.register(new PlanGeneratorSkill())
  skillRegistry.register(new PlanExecutorSkill())
  skillRegistry.register(new WorkspaceSetupSkill())
  skillRegistry.register(new TestRunnerSkill())
  skillRegistry.register(new DocsCheckerSkill())
  skillRegistry.register(new LintRunnerSkill())
  skillRegistry.register(new PrCreatorSkill())

  return {
    stateManager,
    skillRegistry,
    signingSecret,
    appSlug,
    logger,
  }
}

/**
 * Start the AgentGit polling loop.
 * This is the main entry point -- no inbound webhooks, no public ports.
 */
export async function startAgentGit(getOctokit: () => any): Promise<Poller> {
  const deps = createAgentGitDeps()
  const pollIntervalMs = parseInt(process.env.AGENTGIT_POLL_INTERVAL_MS || "30000", 10)
  const workerId = process.env.AGENTGIT_WORKER_ID || `local-${process.pid}`

  const poller = createPoller(getOctokit, {
    intervalMs: pollIntervalMs,
    staleThresholdMs: 30 * 60 * 1000,
    appSlug: deps.appSlug,
    signingSecret: deps.signingSecret,
    workerId,
    deps,
  }, deps.logger)

  poller.start()
  deps.logger.info("AgentGit polling started", { intervalMs: pollIntervalMs, workerId })

  return poller
}
