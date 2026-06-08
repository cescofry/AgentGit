import { StateManager } from "../state/manager"
import { Trigger, AgentState } from "../state/transitions"
import { AgentGitConfig } from "../config/defaults"
import { IssueContext } from "../harness/interface"
import { createPlanComment, createStatusComment, createBlockedComment, createSecurityLockComment } from "../github/comments"
import { getActiveDelegations, parseDelegateArgs, createDelegationComment, createRevocationComment, formatDelegationsList, DelegationMetadata } from "../github/delegation"
import { loadTaskDefinition } from "../tasks/loader"
import { runTask, TaskResult } from "../tasks/runner"
import { ResolutionContext } from "../tasks/resolver"
import { SkillRegistry } from "../skills/registry"
import { ExecutionContext } from "../skills/interface"
import { CodingHarness } from "../harness/interface"
import { OpenCodeHarness } from "../harness/opencode"
import { PiHarness } from "../harness/pi"
import { Logger } from "../utils/logger"
import { parseMetadataComment } from "../utils/metadata"

// ── Types ──

/**
 * Minimal context interface for handler functions.
 * Keeps handlers testable without tight coupling to a specific framework.
 */
export interface HandlerContext {
  octokit: any
  repo(): { owner: string; repo: string }
  issue(data?: any): { owner: string; repo: string; issue_number: number } & Record<string, any>
}

export interface HandlerDeps {
  stateManager: StateManager
  skillRegistry: SkillRegistry
  signingSecret: string
  appSlug: string
  logger: Logger
}

// ── Helpers ──

/**
 * Build an IssueContext from the GitHub API issue data.
 */
export async function buildIssueContext(
  context: HandlerContext,
  issue: any,
): Promise<IssueContext> {
  const { owner, repo } = context.repo()
  const comments = await context.octokit.issues.listComments(context.issue())
  return {
    issueNumber: issue.number,
    issueTitle: issue.title,
    issueBody: issue.body || "",
    comments: comments.data.map((c: any) => ({
      author: c.user?.login || "unknown",
      body: c.body || "",
      createdAt: c.created_at,
    })),
    labels: issue.labels?.map((l: any) => l.name) || [],
    repoUrl: `https://github.com/${owner}/${repo}`,
    repoOwner: owner,
    repoName: repo,
  }
}

/**
 * Create the appropriate CodingHarness based on config.
 */
function createHarness(config: AgentGitConfig): CodingHarness {
  if (config.execution.harness === "pi") {
    return new PiHarness()
  }
  return new OpenCodeHarness(config.execution.model)
}

/**
 * Build an ExecutionContext for running tasks.
 */
function buildExecutionContext(
  issueContext: IssueContext,
  config: AgentGitConfig,
  logger: Logger,
  signingSecret: string,
): ExecutionContext {
  const harness = createHarness(config)
  return {
    issueContext,
    repoConfig: config,
    logger,
    harness,
    workspacePath: `${config.execution_environment.workspace_root}/issue-${issueContext.issueNumber}`,
    signingSecret,
  }
}

/**
 * Build a ResolutionContext for task input resolution.
 */
function buildResolutionContext(
  issueContext: IssueContext,
  config: AgentGitConfig,
): ResolutionContext {
  return {
    issue: issueContext,
    config,
    phases: {},
  }
}

/**
 * Transition state with error handling. Posts a comment if the transition is invalid.
 */
async function transitionState(
  context: HandlerContext,
  deps: HandlerDeps,
  trigger: Trigger,
): Promise<{ valid: boolean; to: AgentState }> {
  const { owner, repo } = context.repo()
  const issueNumber = context.issue().issue_number
  const result = await deps.stateManager.transition(
    context.octokit,
    owner,
    repo,
    issueNumber,
    trigger,
  )
  if (!result.valid) {
    await context.octokit.issues.createComment(
      context.issue({ body: createStatusComment("Invalid transition", result.reason) }),
    )
  }
  return { valid: result.valid, to: result.to }
}

/**
 * Get the current agent state for the issue.
 */
async function getCurrentState(
  context: HandlerContext,
  deps: HandlerDeps,
): Promise<AgentState> {
  const { owner, repo } = context.repo()
  const issueNumber = context.issue().issue_number
  return deps.stateManager.getCurrentState(context.octokit, owner, repo, issueNumber)
}

// ── Plan flow (shared between handlePlan, handleRetry, label trigger) ──

/**
 * Run the full plan flow: security review -> planning -> post plan comment.
 */
export async function executePlanFlow(
  context: HandlerContext,
  config: AgentGitConfig,
  deps: HandlerDeps,
  issue: any,
  feedback?: string,
): Promise<void> {
  const { owner, repo } = context.repo()
  const issueContext = await buildIssueContext(context, issue)
  const executionContext = buildExecutionContext(issueContext, config, deps.logger, deps.signingSecret)
  const resolutionContext = buildResolutionContext(issueContext, config)

  // ── Phase 1: Security review ──
  if (config.security.pre_plan_check.enabled) {
    const prePlanTask = await loadTaskDefinition("pre-plan", context.octokit, owner, repo)

    if (prePlanTask) {
      const safetyResult = await runTask(prePlanTask, {
        skillRegistry: deps.skillRegistry,
        executionContext,
        resolutionContext,
      })

      if (!safetyResult.success) {
        if (safetyResult.failureAction === "lock-security") {
          // Transition to locked-security
          await transitionState(context, deps, "security_review_failed")
          const category = safetyResult.phaseResults?.["safety-check"]?.data?.category || "unknown"
          const reason = safetyResult.error || "Security check failed"
          await context.octokit.issues.createComment(
            context.issue({
              body: createSecurityLockComment(issue.number, category, reason, deps.signingSecret),
            }),
          )
          return
        }
        // Other failure: block
        await transitionState(context, deps, "security_review_failed")
        await context.octokit.issues.createComment(
          context.issue({
            body: createBlockedComment(issue.number, safetyResult.error || "Security check failed", "pre-plan", deps.signingSecret),
          }),
        )
        return
      }

      // Check if the safety check result says unsafe
      const safetyData = safetyResult.phaseResults?.["safety-check"]?.data
      if (safetyData && !safetyData.safe) {
        await transitionState(context, deps, "security_review_failed")
        await context.octokit.issues.createComment(
          context.issue({
            body: createSecurityLockComment(
              issue.number,
              safetyData.category || "unknown",
              safetyData.reason || "Task failed safety review",
              deps.signingSecret,
            ),
          }),
        )
        return
      }
    }

    // Security review passed
    const secTransition = await transitionState(context, deps, "security_review_passed")
    if (!secTransition.valid) return
  } else {
    // Skip security, go directly to planning
    const secTransition = await transitionState(context, deps, "security_review_passed")
    if (!secTransition.valid) return
  }

  // ── Phase 2: Planning ──
  const planTask = await loadTaskDefinition("plan", context.octokit, owner, repo)
  if (!planTask) {
    await context.octokit.issues.createComment(
      context.issue({
        body: createBlockedComment(issue.number, "Could not load plan task definition", "planning", deps.signingSecret),
      }),
    )
    await transitionState(context, deps, "plan_failed")
    return
  }

  // If we have feedback, inject it into the resolution context
  if (feedback) {
    resolutionContext.plan = feedback
  }

  const planResult = await runTask(planTask, {
    skillRegistry: deps.skillRegistry,
    executionContext,
    resolutionContext,
  })

  if (!planResult.success) {
    await context.octokit.issues.createComment(
      context.issue({
        body: createBlockedComment(issue.number, planResult.error || "Plan generation failed", "planning", deps.signingSecret),
      }),
    )
    await transitionState(context, deps, "plan_failed")
    return
  }

  // Extract the generated plan from phase results
  const generatedPlan = planResult.phaseResults?.["generate-plan"]?.data?.plan
    || planResult.phaseResults?.["plan"]?.data?.plan
    || "Plan generated successfully (see phase results for details)"

  const planVersion = planResult.phaseResults?.["generate-plan"]?.data?.planVersion
    || planResult.phaseResults?.["plan"]?.data?.planVersion
    || 1

  // Post plan comment
  const planComment = createPlanComment(
    generatedPlan,
    planVersion,
    issue.number,
    config.execution.harness,
    config.execution.plan_model,
    deps.signingSecret,
  )

  await context.octokit.issues.createComment(context.issue({ body: planComment }))

  // Transition to plan-review
  await transitionState(context, deps, "plan_completed")
}

// ── Command Handlers ──

export async function handlePlan(
  context: HandlerContext,
  config: AgentGitConfig,
  deps: HandlerDeps,
  issue: any,
): Promise<void> {
  // Transition: null/ready/cancelled -> security-review
  const transition = await transitionState(context, deps, "plan_requested")
  if (!transition.valid) return

  await context.octokit.issues.createComment(
    context.issue({ body: createStatusComment("Planning started", "Running security review...") }),
  )

  await executePlanFlow(context, config, deps, issue)
}

export async function handleApprove(
  context: HandlerContext,
  config: AgentGitConfig,
  deps: HandlerDeps,
  issue: any,
  sender: string,
): Promise<void> {
  // Verify current state is plan-review
  const currentState = await getCurrentState(context, deps)
  if (currentState !== "agent:plan-review") {
    await context.octokit.issues.createComment(
      context.issue({
        body: createStatusComment(
          "Cannot approve",
          `Current state is \`${currentState || "none"}\`. The plan can only be approved when in \`agent:plan-review\` state.`,
        ),
      }),
    )
    return
  }

  const transition = await transitionState(context, deps, "plan_approved")
  if (!transition.valid) return

  await context.octokit.issues.createComment(
    context.issue({
      body: createStatusComment("Plan approved", `Plan approved by @${sender}. Ready for execution.`),
    }),
  )
}

export async function handleRevise(
  context: HandlerContext,
  config: AgentGitConfig,
  deps: HandlerDeps,
  issue: any,
  feedback: string,
): Promise<void> {
  // Verify current state is plan-review
  const currentState = await getCurrentState(context, deps)
  if (currentState !== "agent:plan-review") {
    await context.octokit.issues.createComment(
      context.issue({
        body: createStatusComment(
          "Cannot revise",
          `Current state is \`${currentState || "none"}\`. Revisions can only be requested in \`agent:plan-review\` state.`,
        ),
      }),
    )
    return
  }

  const transition = await transitionState(context, deps, "revise_requested")
  if (!transition.valid) return

  await context.octokit.issues.createComment(
    context.issue({ body: createStatusComment("Revision requested", "Re-generating plan with feedback...") }),
  )

  await executePlanFlow(context, config, deps, issue, feedback)
}

export async function handleRun(
  context: HandlerContext,
  config: AgentGitConfig,
  deps: HandlerDeps,
  issue: any,
  sender: string,
): Promise<void> {
  // /agent run = approve + start build
  // First approve
  const currentState = await getCurrentState(context, deps)
  if (currentState === "agent:plan-review") {
    await handleApprove(context, config, deps, issue, sender)
  }

  // Now start build
  const stateAfterApprove = await getCurrentState(context, deps)
  if (stateAfterApprove !== "agent:approved") {
    await context.octokit.issues.createComment(
      context.issue({
        body: createStatusComment(
          "Cannot run",
          `Current state is \`${stateAfterApprove || "none"}\`. Expected \`agent:approved\`.`,
        ),
      }),
    )
    return
  }

  // Transition to working
  const workTransition = await transitionState(context, deps, "work_started")
  if (!workTransition.valid) return

  await context.octokit.issues.createComment(
    context.issue({ body: createStatusComment("Build started", "Agent is implementing the approved plan...") }),
  )

  // Execute build
  const { owner, repo } = context.repo()
  const issueContext = await buildIssueContext(context, issue)
  const executionContext = buildExecutionContext(issueContext, config, deps.logger, deps.signingSecret)
  const resolutionContext = buildResolutionContext(issueContext, config)

  const buildTask = await loadTaskDefinition("build", context.octokit, owner, repo)
  if (!buildTask) {
    await context.octokit.issues.createComment(
      context.issue({
        body: createBlockedComment(issue.number, "Could not load build task definition", "build", deps.signingSecret),
      }),
    )
    await transitionState(context, deps, "build_failed")
    return
  }

  const buildResult = await runTask(buildTask, {
    skillRegistry: deps.skillRegistry,
    executionContext,
    resolutionContext,
  })

  if (!buildResult.success) {
    await context.octokit.issues.createComment(
      context.issue({
        body: createBlockedComment(issue.number, buildResult.error || "Build failed", "build", deps.signingSecret),
      }),
    )
    await transitionState(context, deps, "build_failed")
    return
  }

  // Run post-build tasks
  const postBuildTask = await loadTaskDefinition("post-build", context.octokit, owner, repo)
  if (postBuildTask) {
    const postBuildContext: ResolutionContext = {
      ...resolutionContext,
      build: { phases: buildResult.phaseResults },
    }
    await runTask(postBuildTask, {
      skillRegistry: deps.skillRegistry,
      executionContext,
      resolutionContext: postBuildContext,
    })
  }

  // Transition to pr-opened
  await transitionState(context, deps, "build_completed")

  await context.octokit.issues.createComment(
    context.issue({ body: createStatusComment("Build completed", "PR has been opened.") }),
  )
}

export async function handleStop(
  context: HandlerContext,
  deps: HandlerDeps,
  sender: string,
): Promise<void> {
  const transition = await transitionState(context, deps, "stop_requested")
  if (!transition.valid) return

  await context.octokit.issues.createComment(
    context.issue({
      body: createStatusComment("Cancelled", `Agent flow stopped by @${sender}.`),
    }),
  )
}

export async function handleRetry(
  context: HandlerContext,
  config: AgentGitConfig,
  deps: HandlerDeps,
  issue: any,
): Promise<void> {
  const currentState = await getCurrentState(context, deps)
  if (currentState !== "agent:blocked") {
    await context.octokit.issues.createComment(
      context.issue({
        body: createStatusComment(
          "Cannot retry",
          `Current state is \`${currentState || "none"}\`. Retry is only available in \`agent:blocked\` state.`,
        ),
      }),
    )
    return
  }

  const transition = await transitionState(context, deps, "retry_requested")
  if (!transition.valid) return

  await context.octokit.issues.createComment(
    context.issue({ body: createStatusComment("Retrying", "Re-running the plan flow...") }),
  )

  // Re-run plan flow (transitions from planning onward)
  await executePlanFlow(context, config, deps, issue)
}

export async function handleStatus(
  context: HandlerContext,
  deps: HandlerDeps,
): Promise<void> {
  const currentState = await getCurrentState(context, deps)

  const stateDescription = currentState || "No agent state (not started)"
  let details = `**Current state:** \`${stateDescription}\``

  switch (currentState) {
    case null:
      details += "\n\nUse `/agent plan` to start the planning flow."
      break
    case "agent:plan-review":
      details += "\n\nA plan is awaiting review. Use `/agent approve` to approve or `/agent revise <feedback>` to request changes."
      break
    case "agent:approved":
      details += "\n\nPlan approved. Use `/agent run` to start execution."
      break
    case "agent:blocked":
      details += "\n\nAgent is blocked. Use `/agent retry` to re-attempt or `/agent stop` to cancel."
      break
    case "agent:locked-security":
      details += "\n\nIssue is security-locked. A security admin must use `/agent unlock-security` or `/agent close-unsafe`."
      break
    case "agent:done":
      details += "\n\nWork is completed."
      break
    case "agent:cancelled":
      details += "\n\nAgent flow was cancelled. Use `/agent plan` to restart."
      break
  }

  await context.octokit.issues.createComment(
    context.issue({ body: createStatusComment("Agent Status", details) }),
  )
}

export async function handleDelegate(
  context: HandlerContext,
  deps: HandlerDeps,
  args: string,
  sender: string,
  issue: any,
): Promise<void> {
  const parsed = parseDelegateArgs(args)
  if (!parsed) {
    await context.octokit.issues.createComment(
      context.issue({
        body: createStatusComment("Invalid delegation", "Usage: `/agent delegate @username [scope1 scope2 ...]`"),
      }),
    )
    return
  }

  const comment = createDelegationComment(
    issue.number,
    sender,
    parsed.username,
    parsed.scopes,
    deps.signingSecret,
  )

  await context.octokit.issues.createComment(context.issue({ body: comment }))
}

export async function handleUndelegate(
  context: HandlerContext,
  deps: HandlerDeps,
  args: string,
  sender: string,
  issue: any,
): Promise<void> {
  const trimmed = args.trim()
  const match = trimmed.match(/^@([a-zA-Z0-9_-]+)/)
  if (!match) {
    await context.octokit.issues.createComment(
      context.issue({
        body: createStatusComment("Invalid revocation", "Usage: `/agent undelegate @username`"),
      }),
    )
    return
  }

  const username = match[1]
  const comment = createRevocationComment(issue.number, sender, username, deps.signingSecret)

  await context.octokit.issues.createComment(context.issue({ body: comment }))
}

export async function handleListDelegates(
  context: HandlerContext,
  deps: HandlerDeps,
  issue: any,
): Promise<void> {
  const commentsResponse = await context.octokit.issues.listComments(context.issue())
  const delegations = getActiveDelegations(
    commentsResponse.data.map((c: any) => ({
      user: { login: c.user!.login, type: c.user!.type },
      body: c.body || "",
    })),
    deps.appSlug,
    deps.signingSecret,
    issue.number,
  )

  const list = formatDelegationsList(delegations)
  await context.octokit.issues.createComment(
    context.issue({ body: createStatusComment("Active Delegations", list) }),
  )
}

export async function handleUnlockSecurity(
  context: HandlerContext,
  deps: HandlerDeps,
  config: AgentGitConfig,
  issue: any,
  sender: string,
): Promise<void> {
  const currentState = await getCurrentState(context, deps)
  if (currentState !== "agent:locked-security") {
    await context.octokit.issues.createComment(
      context.issue({
        body: createStatusComment(
          "Cannot unlock",
          `Current state is \`${currentState || "none"}\`. Unlock is only available in \`agent:locked-security\` state.`,
        ),
      }),
    )
    return
  }

  const transition = await transitionState(context, deps, "unlock_security")
  if (!transition.valid) return

  await context.octokit.issues.createComment(
    context.issue({
      body: createStatusComment("Security unlocked", `Issue unlocked by @${sender}. Proceeding to planning.`),
    }),
  )

  // Continue to plan flow
  await executePlanFlow(context, config, deps, issue)
}

export async function handleCloseUnsafe(
  context: HandlerContext,
  deps: HandlerDeps,
  sender: string,
): Promise<void> {
  const currentState = await getCurrentState(context, deps)
  if (currentState !== "agent:locked-security") {
    await context.octokit.issues.createComment(
      context.issue({
        body: createStatusComment(
          "Cannot close as unsafe",
          `Current state is \`${currentState || "none"}\`. This command is only available in \`agent:locked-security\` state.`,
        ),
      }),
    )
    return
  }

  const transition = await transitionState(context, deps, "close_unsafe")
  if (!transition.valid) return

  await context.octokit.issues.createComment(
    context.issue({
      body: createStatusComment("Closed as unsafe", `Issue closed as unsafe by @${sender}. Agent state removed.`),
    }),
  )

  // Close the issue
  const { owner, repo } = context.repo()
  await context.octokit.issues.update({
    owner,
    repo,
    issue_number: context.issue().issue_number,
    state: "closed",
  })
}

export async function handleSecurityStatus(
  context: HandlerContext,
  deps: HandlerDeps,
): Promise<void> {
  const currentState = await getCurrentState(context, deps)

  let details: string
  if (currentState === "agent:locked-security") {
    // Find the lock comment to extract details
    const commentsResponse = await context.octokit.issues.listComments(context.issue())
    let lockReason = "Unknown reason"
    let lockCategory = "unknown"

    for (const c of commentsResponse.data.reverse()) {
      const parsed = parseMetadataComment(c.body || "")
      if (parsed && (parsed.metadata as any).type === "security_lock") {
        lockCategory = (parsed.metadata as any).category || "unknown"
        lockReason = `Category: ${lockCategory}`
        break
      }
    }

    details = [
      `**Security status:** Locked`,
      `**Reason:** ${lockReason}`,
      "",
      "A security admin must use `/agent unlock-security` to proceed or `/agent close-unsafe` to close this issue.",
    ].join("\n")
  } else {
    details = `**Security status:** No security lock active.\n**Current state:** \`${currentState || "none"}\``
  }

  await context.octokit.issues.createComment(
    context.issue({ body: createStatusComment("Security Status", details) }),
  )
}
