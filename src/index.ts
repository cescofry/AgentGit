import { Probot } from "probot"
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
import { parseMetadataComment } from "./utils/metadata"
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

dotenv.config()

export default function agentGitApp(app: Probot): void {
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

  const deps: HandlerDeps = {
    stateManager,
    skillRegistry,
    signingSecret,
    appSlug,
    logger,
  }

  // ── Issue Comment Handler ──
  app.on("issue_comment.created", async (context) => {
    const comment = context.payload.comment
    const issue = context.payload.issue
    const sender = context.payload.sender

    // Parse command
    const command = parseCommand(comment.body)
    if (!command) return

    const { owner, repo } = context.repo()

    // Load config
    const { config } = await loadConfig(context.octokit, owner, repo)
    if (!config.enabled) return

    // Build auth context
    const authContext: AuthorizationContext = {
      senderLogin: sender.login,
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
      const comments = await context.octokit.issues.listComments(
        context.issue(),
      )
      const delegations = getActiveDelegations(
        comments.data.map((c: any) => ({
          user: { login: c.user!.login, type: c.user!.type },
          body: c.body || "",
        })),
        appSlug,
        signingSecret,
        issueNum,
      )
      return delegations.map((d) => ({
        username: d.delegated_to,
        command: d.scopes.includes(command.action) ? command.action : "",
      }))
    }

    const authResult = await isAuthorized(
      context.octokit,
      command.action,
      authContext,
      getDelegations,
    )
    if (!authResult.authorized) {
      await context.octokit.issues.createComment(
        context.issue({ body: `@${sender.login} ${authResult.reason}` }),
      )
      return
    }

    // Wrap Probot context as HandlerContext
    const handlerCtx: HandlerContext = {
      octokit: context.octokit,
      repo: () => context.repo(),
      issue: (data?: any) => context.issue(data),
    }

    // Dispatch command
    logger.info(`Dispatching command: ${command.action}`, {
      sender: sender.login,
      issue: issue.number,
      repo: `${owner}/${repo}`,
    })

    switch (command.action) {
      case "plan":
        await handlePlan(handlerCtx, config, deps, issue)
        break
      case "approve":
        await handleApprove(handlerCtx, config, deps, issue, sender.login)
        break
      case "revise":
        await handleRevise(handlerCtx, config, deps, issue, command.args)
        break
      case "run":
        await handleRun(handlerCtx, config, deps, issue, sender.login)
        break
      case "stop":
        await handleStop(handlerCtx, deps, sender.login)
        break
      case "retry":
        await handleRetry(handlerCtx, config, deps, issue)
        break
      case "status":
        await handleStatus(handlerCtx, deps)
        break
      case "delegate":
        await handleDelegate(handlerCtx, deps, command.args, sender.login, issue)
        break
      case "undelegate":
        await handleUndelegate(handlerCtx, deps, command.args, sender.login, issue)
        break
      case "delegates":
        await handleListDelegates(handlerCtx, deps, issue)
        break
      case "unlock-security":
        await handleUnlockSecurity(handlerCtx, deps, config, issue, sender.login)
        break
      case "close-unsafe":
        await handleCloseUnsafe(handlerCtx, deps, sender.login)
        break
      case "security-status":
        await handleSecurityStatus(handlerCtx, deps)
        break
      default:
        logger.warn(`Unknown command action: ${command.action}`)
    }
  })

  // ── Label Handler ──
  app.on("issues.labeled", async (context) => {
    const label = context.payload.label?.name
    const issue = context.payload.issue

    // Only trigger on configured ready labels
    const { owner, repo } = context.repo()
    const { config } = await loadConfig(context.octokit, owner, repo)
    if (!config.enabled) return

    const readyLabels = config.ready_labels || ["agent:ready"]
    if (!label || !readyLabels.includes(label)) return

    logger.info(`Ready label added: ${label}`, {
      issue: issue.number,
      repo: `${owner}/${repo}`,
    })

    const handlerCtx: HandlerContext = {
      octokit: context.octokit,
      repo: () => context.repo(),
      issue: (data?: any) => context.issue(data),
    }

    // Trigger plan flow (same as /agent plan)
    await handlePlan(handlerCtx, config, deps, issue)
  })

  // ── PR Merged Handler ──
  app.on("pull_request.closed", async (context) => {
    const pr = context.payload.pull_request
    if (!pr.merged) return

    const { owner, repo } = context.repo()
    const { config } = await loadConfig(context.octokit, owner, repo)
    if (!config.enabled) return

    // Check if PR was created by the bot
    const branchPrefix = config.execution.branch_prefix || "agent/"
    const provenance = verifyPrProvenance(
      {
        user: { login: pr.user.login, type: pr.user.type },
        body: pr.body || "",
        head: { ref: pr.head.ref },
      },
      appSlug,
      branchPrefix,
      signingSecret,
    )

    if (!provenance.valid) return

    // Find linked issue from PR body metadata
    const parsed = parseMetadataComment(pr.body || "")
    if (!parsed) return

    const metadata = parsed.metadata as Record<string, any>
    const issueNumber = metadata.issue_number
    if (!issueNumber) return

    logger.info(`PR #${pr.number} merged for issue #${issueNumber}`, {
      repo: `${owner}/${repo}`,
    })

    // Transition to done
    await stateManager.transition(
      context.octokit as any,
      owner,
      repo,
      issueNumber,
      "pr_merged",
    )

    // Post completion comment on the issue
    await context.octokit.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: createStatusComment("Completed", `PR #${pr.number} has been merged. Issue resolved.`),
    })
  })

  logger.info("AgentGit app loaded successfully")
}
