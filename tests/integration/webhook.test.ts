import { describe, it, expect, vi, beforeEach } from "vitest"
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
  HandlerContext,
  HandlerDeps,
} from "../../src/commands/handlers"
import { parseCommand } from "../../src/commands/parser"
import { createStateManager, StateManager } from "../../src/state/manager"
import { createSkillRegistry, SkillRegistry } from "../../src/skills/registry"
import { createLogger } from "../../src/utils/logger"
import { DEFAULT_CONFIG } from "../../src/config/defaults"
import { AgentState, Trigger, TransitionResult } from "../../src/state/transitions"

// ── Mock Helpers ──

function createMockOctokit(overrides: Record<string, any> = {}) {
  return {
    issues: {
      listComments: vi.fn().mockResolvedValue({ data: [] }),
      createComment: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      listLabelsOnIssue: vi.fn().mockResolvedValue({ data: [] }),
      addLabels: vi.fn().mockResolvedValue({}),
      removeLabel: vi.fn().mockResolvedValue({}),
    },
    rest: {
      issues: {
        listLabelsOnIssue: vi.fn().mockResolvedValue({ data: [] }),
        addLabels: vi.fn().mockResolvedValue({}),
        removeLabel: vi.fn().mockResolvedValue({}),
      },
      repos: {
        getCollaboratorPermissionLevel: vi.fn().mockResolvedValue({
          data: { permission: "admin" },
        }),
        getLabel: vi.fn().mockResolvedValue({}),
        createLabel: vi.fn().mockResolvedValue({}),
        getContent: vi.fn().mockRejectedValue({ status: 404 }),
      },
    },
    ...overrides,
  }
}

function createMockHandlerContext(
  octokit?: any,
  issueNumber: number = 42,
): HandlerContext {
  const mock = octokit || createMockOctokit()
  return {
    octokit: mock,
    repo: () => ({ owner: "test-owner", repo: "test-repo" }),
    issue: (data?: any) => ({
      owner: "test-owner",
      repo: "test-repo",
      issue_number: issueNumber,
      ...data,
    }),
  }
}

function createMockIssue(overrides: Record<string, any> = {}) {
  return {
    number: 42,
    title: "Fix the bug",
    body: "There is a bug that needs fixing",
    labels: [{ name: "bug" }],
    ...overrides,
  }
}

function createMockStateManager(currentState: AgentState = null): StateManager {
  return {
    getCurrentState: vi.fn().mockResolvedValue(currentState),
    transition: vi.fn().mockImplementation(
      async (
        _octokit: any,
        _owner: string,
        _repo: string,
        _issueNumber: number,
        trigger: Trigger,
      ): Promise<TransitionResult> => {
        // Simple mock: always succeed
        return {
          valid: true,
          from: currentState,
          to: "agent:planning" as AgentState,
          trigger,
        }
      },
    ),
    ensureLabel: vi.fn().mockResolvedValue(undefined),
    ensureAllLabels: vi.fn().mockResolvedValue(undefined),
  }
}

function createMockDeps(overrides: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    stateManager: createMockStateManager(),
    skillRegistry: createSkillRegistry(),
    signingSecret: "test-secret",
    appSlug: "agentgit",
    logger: createLogger("error"),
    ...overrides,
  }
}

// ── Tests ──

describe("Webhook Integration - Handler Functions", () => {
  describe("buildIssueContext", () => {
    it("should build issue context from webhook data", async () => {
      const octokit = createMockOctokit()
      octokit.issues.listComments.mockResolvedValue({
        data: [
          {
            user: { login: "alice" },
            body: "I can reproduce this",
            created_at: "2024-01-01T00:00:00Z",
          },
        ],
      })

      const ctx = createMockHandlerContext(octokit)
      const issue = createMockIssue()

      const result = await buildIssueContext(ctx, issue)

      expect(result.issueNumber).toBe(42)
      expect(result.issueTitle).toBe("Fix the bug")
      expect(result.issueBody).toBe("There is a bug that needs fixing")
      expect(result.repoOwner).toBe("test-owner")
      expect(result.repoName).toBe("test-repo")
      expect(result.repoUrl).toBe("https://github.com/test-owner/test-repo")
      expect(result.labels).toEqual(["bug"])
      expect(result.comments).toHaveLength(1)
      expect(result.comments[0].author).toBe("alice")
      expect(result.comments[0].body).toBe("I can reproduce this")
    })

    it("should handle empty body and no labels", async () => {
      const ctx = createMockHandlerContext()
      const issue = createMockIssue({ body: null, labels: undefined })

      const result = await buildIssueContext(ctx, issue)

      expect(result.issueBody).toBe("")
      expect(result.labels).toEqual([])
    })
  })

  describe("handleStatus", () => {
    it("should post status with null state", async () => {
      const octokit = createMockOctokit()
      const ctx = createMockHandlerContext(octokit)
      const deps = createMockDeps({
        stateManager: createMockStateManager(null),
      })

      await handleStatus(ctx, deps)

      expect(octokit.issues.createComment).toHaveBeenCalledTimes(1)
      const body = octokit.issues.createComment.mock.calls[0][0].body
      expect(body).toContain("Agent Status")
      expect(body).toContain("/agent plan")
    })

    it("should post status for plan-review state", async () => {
      const octokit = createMockOctokit()
      const ctx = createMockHandlerContext(octokit)
      const deps = createMockDeps({
        stateManager: createMockStateManager("agent:plan-review"),
      })

      await handleStatus(ctx, deps)

      const body = octokit.issues.createComment.mock.calls[0][0].body
      expect(body).toContain("/agent approve")
      expect(body).toContain("/agent revise")
    })

    it("should post status for blocked state", async () => {
      const octokit = createMockOctokit()
      const ctx = createMockHandlerContext(octokit)
      const deps = createMockDeps({
        stateManager: createMockStateManager("agent:blocked"),
      })

      await handleStatus(ctx, deps)

      const body = octokit.issues.createComment.mock.calls[0][0].body
      expect(body).toContain("/agent retry")
    })

    it("should post status for locked-security state", async () => {
      const octokit = createMockOctokit()
      const ctx = createMockHandlerContext(octokit)
      const deps = createMockDeps({
        stateManager: createMockStateManager("agent:locked-security"),
      })

      await handleStatus(ctx, deps)

      const body = octokit.issues.createComment.mock.calls[0][0].body
      expect(body).toContain("/agent unlock-security")
    })
  })

  describe("handleStop", () => {
    it("should transition to cancelled and post comment", async () => {
      const octokit = createMockOctokit()
      const ctx = createMockHandlerContext(octokit)
      const sm = createMockStateManager("agent:planning")
      const deps = createMockDeps({ stateManager: sm })

      await handleStop(ctx, deps, "admin-user")

      expect(sm.transition).toHaveBeenCalledWith(
        octokit,
        "test-owner",
        "test-repo",
        42,
        "stop_requested",
      )
      expect(octokit.issues.createComment).toHaveBeenCalledTimes(1)
      const body = octokit.issues.createComment.mock.calls[0][0].body
      expect(body).toContain("Cancelled")
      expect(body).toContain("admin-user")
    })

    it("should post invalid transition comment on failure", async () => {
      const octokit = createMockOctokit()
      const ctx = createMockHandlerContext(octokit)
      const sm = createMockStateManager("agent:done")
      ;(sm.transition as any).mockResolvedValue({
        valid: false,
        from: "agent:done",
        to: "agent:done",
        trigger: "stop_requested",
        reason: "Cannot stop from done state",
      })
      const deps = createMockDeps({ stateManager: sm })

      await handleStop(ctx, deps, "admin-user")

      // Should post an "Invalid transition" message, not a "Cancelled" message
      expect(octokit.issues.createComment).toHaveBeenCalledTimes(1)
      const body = octokit.issues.createComment.mock.calls[0][0].body
      expect(body).toContain("Invalid transition")
    })
  })

  describe("handleApprove", () => {
    it("should approve when in plan-review state", async () => {
      const octokit = createMockOctokit()
      const ctx = createMockHandlerContext(octokit)
      const sm = createMockStateManager("agent:plan-review")
      const deps = createMockDeps({ stateManager: sm })

      await handleApprove(ctx, {} as any, deps, createMockIssue(), "reviewer")

      expect(sm.transition).toHaveBeenCalledWith(
        octokit,
        "test-owner",
        "test-repo",
        42,
        "plan_approved",
      )
      const body = octokit.issues.createComment.mock.calls[0][0].body
      expect(body).toContain("Plan approved")
      expect(body).toContain("reviewer")
    })

    it("should reject approval when not in plan-review state", async () => {
      const octokit = createMockOctokit()
      const ctx = createMockHandlerContext(octokit)
      const sm = createMockStateManager("agent:planning")
      const deps = createMockDeps({ stateManager: sm })

      await handleApprove(ctx, {} as any, deps, createMockIssue(), "reviewer")

      // Should post rejection, not call transition
      expect(sm.transition).not.toHaveBeenCalled()
      const body = octokit.issues.createComment.mock.calls[0][0].body
      expect(body).toContain("Cannot approve")
      expect(body).toContain("agent:planning")
    })
  })

  describe("handleRevise", () => {
    it("should reject revision when not in plan-review state", async () => {
      const octokit = createMockOctokit()
      const ctx = createMockHandlerContext(octokit)
      const sm = createMockStateManager(null)
      const deps = createMockDeps({ stateManager: sm })

      await handleRevise(ctx, {} as any, deps, createMockIssue(), "fix the tests")

      expect(sm.transition).not.toHaveBeenCalled()
      const body = octokit.issues.createComment.mock.calls[0][0].body
      expect(body).toContain("Cannot revise")
    })
  })

  describe("handleRetry", () => {
    it("should reject retry when not in blocked state", async () => {
      const octokit = createMockOctokit()
      const ctx = createMockHandlerContext(octokit)
      const sm = createMockStateManager("agent:planning")
      const deps = createMockDeps({ stateManager: sm })

      await handleRetry(ctx, {} as any, deps, createMockIssue())

      expect(sm.transition).not.toHaveBeenCalled()
      const body = octokit.issues.createComment.mock.calls[0][0].body
      expect(body).toContain("Cannot retry")
    })
  })

  describe("handleDelegate", () => {
    it("should create delegation comment for valid args", async () => {
      const octokit = createMockOctokit()
      const ctx = createMockHandlerContext(octokit)
      const deps = createMockDeps()

      await handleDelegate(ctx, deps, "@alice plan revise", "admin-user", createMockIssue())

      expect(octokit.issues.createComment).toHaveBeenCalledTimes(1)
      const body = octokit.issues.createComment.mock.calls[0][0].body
      expect(body).toContain("Delegation granted")
      expect(body).toContain("alice")
    })

    it("should reject invalid delegation args", async () => {
      const octokit = createMockOctokit()
      const ctx = createMockHandlerContext(octokit)
      const deps = createMockDeps()

      await handleDelegate(ctx, deps, "", "admin-user", createMockIssue())

      expect(octokit.issues.createComment).toHaveBeenCalledTimes(1)
      const body = octokit.issues.createComment.mock.calls[0][0].body
      expect(body).toContain("Invalid delegation")
    })

    it("should reject delegation without @username", async () => {
      const octokit = createMockOctokit()
      const ctx = createMockHandlerContext(octokit)
      const deps = createMockDeps()

      await handleDelegate(ctx, deps, "alice plan", "admin-user", createMockIssue())

      const body = octokit.issues.createComment.mock.calls[0][0].body
      expect(body).toContain("Invalid delegation")
    })
  })

  describe("handleUndelegate", () => {
    it("should create revocation comment for valid args", async () => {
      const octokit = createMockOctokit()
      const ctx = createMockHandlerContext(octokit)
      const deps = createMockDeps()

      await handleUndelegate(ctx, deps, "@alice", "admin-user", createMockIssue())

      expect(octokit.issues.createComment).toHaveBeenCalledTimes(1)
      const body = octokit.issues.createComment.mock.calls[0][0].body
      expect(body).toContain("Delegation revoked")
      expect(body).toContain("alice")
    })

    it("should reject invalid undelegate args", async () => {
      const octokit = createMockOctokit()
      const ctx = createMockHandlerContext(octokit)
      const deps = createMockDeps()

      await handleUndelegate(ctx, deps, "", "admin-user", createMockIssue())

      const body = octokit.issues.createComment.mock.calls[0][0].body
      expect(body).toContain("Invalid revocation")
    })
  })

  describe("handleListDelegates", () => {
    it("should list no delegations when none exist", async () => {
      const octokit = createMockOctokit()
      const ctx = createMockHandlerContext(octokit)
      const deps = createMockDeps()

      await handleListDelegates(ctx, deps, createMockIssue())

      expect(octokit.issues.createComment).toHaveBeenCalledTimes(1)
      const body = octokit.issues.createComment.mock.calls[0][0].body
      expect(body).toContain("No active delegations")
    })
  })

  describe("handleUnlockSecurity", () => {
    it("should reject unlock when not in locked-security state", async () => {
      const octokit = createMockOctokit()
      const ctx = createMockHandlerContext(octokit)
      const sm = createMockStateManager("agent:planning")
      const deps = createMockDeps({ stateManager: sm })

      await handleUnlockSecurity(ctx, deps, {} as any, createMockIssue(), "sec-admin")

      expect(sm.transition).not.toHaveBeenCalled()
      const body = octokit.issues.createComment.mock.calls[0][0].body
      expect(body).toContain("Cannot unlock")
    })
  })

  describe("handleCloseUnsafe", () => {
    it("should reject close-unsafe when not in locked-security state", async () => {
      const octokit = createMockOctokit()
      const ctx = createMockHandlerContext(octokit)
      const sm = createMockStateManager("agent:plan-review")
      const deps = createMockDeps({ stateManager: sm })

      await handleCloseUnsafe(ctx, deps, "sec-admin")

      expect(sm.transition).not.toHaveBeenCalled()
      const body = octokit.issues.createComment.mock.calls[0][0].body
      expect(body).toContain("Cannot close as unsafe")
    })

    it("should close the issue when in locked-security state", async () => {
      const octokit = createMockOctokit()
      const ctx = createMockHandlerContext(octokit)
      const sm = createMockStateManager("agent:locked-security")
      const deps = createMockDeps({ stateManager: sm })

      await handleCloseUnsafe(ctx, deps, "sec-admin")

      expect(sm.transition).toHaveBeenCalledWith(
        octokit,
        "test-owner",
        "test-repo",
        42,
        "close_unsafe",
      )
      expect(octokit.issues.update).toHaveBeenCalledWith({
        owner: "test-owner",
        repo: "test-repo",
        issue_number: 42,
        state: "closed",
      })
    })
  })

  describe("handleSecurityStatus", () => {
    it("should report no lock when not locked", async () => {
      const octokit = createMockOctokit()
      const ctx = createMockHandlerContext(octokit)
      const sm = createMockStateManager("agent:planning")
      const deps = createMockDeps({ stateManager: sm })

      await handleSecurityStatus(ctx, deps)

      const body = octokit.issues.createComment.mock.calls[0][0].body
      expect(body).toContain("No security lock active")
    })

    it("should report lock details when locked", async () => {
      const octokit = createMockOctokit()
      octokit.issues.listComments.mockResolvedValue({
        data: [
          {
            user: { login: "agentgit[bot]", type: "Bot" },
            body: `<!-- agent-metadata\n{"type":"security_lock","category":"malware","signature":"abc"}\n-->\n\n## Security Lock`,
          },
        ],
      })
      const ctx = createMockHandlerContext(octokit)
      const sm = createMockStateManager("agent:locked-security")
      const deps = createMockDeps({ stateManager: sm })

      await handleSecurityStatus(ctx, deps)

      const body = octokit.issues.createComment.mock.calls[0][0].body
      expect(body).toContain("Locked")
      expect(body).toContain("malware")
    })
  })

  describe("handlePlan", () => {
    it("should transition to security-review and run plan flow", async () => {
      const octokit = createMockOctokit()
      // getContent returns 404 for task definitions (fall back to defaults)
      octokit.rest.repos.getContent.mockRejectedValue({ status: 404 })
      const ctx = createMockHandlerContext(octokit)
      const sm = createMockStateManager(null)
      const deps = createMockDeps({ stateManager: sm })

      await handlePlan(ctx, { ...DEFAULT_CONFIG }, deps, createMockIssue())

      // Should have called transition with plan_requested first
      expect(sm.transition).toHaveBeenCalledWith(
        octokit,
        "test-owner",
        "test-repo",
        42,
        "plan_requested",
      )
      // Should have posted a "Planning started" comment
      const firstCommentBody = octokit.issues.createComment.mock.calls[0][0].body
      expect(firstCommentBody).toContain("Planning started")
    })

    it("should not proceed if plan_requested transition fails", async () => {
      const octokit = createMockOctokit()
      const ctx = createMockHandlerContext(octokit)
      const sm = createMockStateManager("agent:done")
      ;(sm.transition as any).mockResolvedValue({
        valid: false,
        from: "agent:done",
        to: "agent:done",
        trigger: "plan_requested",
        reason: "Cannot plan from done",
      })
      const deps = createMockDeps({ stateManager: sm })

      await handlePlan(ctx, { ...DEFAULT_CONFIG }, deps, createMockIssue())
      const body = octokit.issues.createComment.mock.calls[0][0].body
      expect(body).toContain("Invalid transition")
    })
  })

  describe("handleRun", () => {
    it("should reject run when not in plan-review or approved state", async () => {
      const octokit = createMockOctokit()
      const ctx = createMockHandlerContext(octokit)
      const sm = createMockStateManager("agent:planning")
      const deps = createMockDeps({ stateManager: sm })

      await handleRun(ctx, { ...DEFAULT_CONFIG }, deps, createMockIssue(), "runner")

      // Should have a "Cannot" comment since state is agent:planning
      const calls = octokit.issues.createComment.mock.calls
      const bodies = calls.map((c: any) => c[0].body)
      const hasCannotMessage = bodies.some(
        (b: string) => b.includes("Cannot approve") || b.includes("Cannot run"),
      )
      expect(hasCannotMessage).toBe(true)
    })
  })
})

describe("Webhook Integration - Non-command Handling", () => {
  it("should not match non-command comments", async () => {
    // This tests the parseCommand function indirectly
    const { parseCommand } = await import("../../src/commands/parser")

    expect(parseCommand("Hello, this is a regular comment")).toBeNull()
    expect(parseCommand("I think we should fix this bug")).toBeNull()
    expect(parseCommand("/help me with this")).toBeNull()
    expect(parseCommand("")).toBeNull()
  })

  it("should match valid command comments", async () => {
    const { parseCommand } = await import("../../src/commands/parser")

    const plan = parseCommand("/agent plan")
    expect(plan).toEqual({ action: "plan", args: "" })

    const approve = parseCommand("/agent approve")
    expect(approve).toEqual({ action: "approve", args: "" })

    const revise = parseCommand("/agent revise please add error handling")
    expect(revise).toEqual({ action: "revise", args: "please add error handling" })

    const delegate = parseCommand("/agent delegate @alice plan revise")
    expect(delegate).toEqual({ action: "delegate", args: "@alice plan revise" })

    const status = parseCommand("/agent status")
    expect(status).toEqual({ action: "status", args: "" })

    const stop = parseCommand("/agent stop")
    expect(stop).toEqual({ action: "stop", args: "" })
  })
})

describe("Webhook Integration - Command Dispatch", () => {
  it("should dispatch all command names to the right handler", () => {
    // This tests the switch statement coverage in index.ts by verifying
    // all supported commands are in the parser's recognized set
    const commands = [
      "plan", "approve", "revise", "run", "stop", "retry",
      "delegate", "undelegate", "delegates", "status",
      "unlock-security", "close-unsafe", "security-status",
    ]

    for (const cmd of commands) {
      const result = parseCommand(`/agent ${cmd}`)
      expect(result).not.toBeNull()
      expect(result!.action).toBe(cmd)
    }
  })
})

describe("Webhook Integration - State Gate Checks", () => {
  const gateTests: Array<{
    handler: string
    requiredState: AgentState
    wrongState: AgentState
    expectedMessage: string
  }> = [
    {
      handler: "handleApprove",
      requiredState: "agent:plan-review",
      wrongState: null,
      expectedMessage: "Cannot approve",
    },
    {
      handler: "handleRevise",
      requiredState: "agent:plan-review",
      wrongState: "agent:working",
      expectedMessage: "Cannot revise",
    },
    {
      handler: "handleRetry",
      requiredState: "agent:blocked",
      wrongState: "agent:plan-review",
      expectedMessage: "Cannot retry",
    },
    {
      handler: "handleUnlockSecurity",
      requiredState: "agent:locked-security",
      wrongState: "agent:planning",
      expectedMessage: "Cannot unlock",
    },
    {
      handler: "handleCloseUnsafe",
      requiredState: "agent:locked-security",
      wrongState: "agent:done",
      expectedMessage: "Cannot close as unsafe",
    },
  ]

  for (const test of gateTests) {
    it(`${test.handler} should reject when state is ${test.wrongState || "null"} (needs ${test.requiredState})`, async () => {
      const octokit = createMockOctokit()
      const ctx = createMockHandlerContext(octokit)
      const sm = createMockStateManager(test.wrongState)
      const deps = createMockDeps({ stateManager: sm })

      const handlers: Record<string, Function> = {
        handleApprove: () => handleApprove(ctx, {} as any, deps, createMockIssue(), "user"),
        handleRevise: () => handleRevise(ctx, {} as any, deps, createMockIssue(), "feedback"),
        handleRetry: () => handleRetry(ctx, {} as any, deps, createMockIssue()),
        handleUnlockSecurity: () => handleUnlockSecurity(ctx, deps, {} as any, createMockIssue(), "admin"),
        handleCloseUnsafe: () => handleCloseUnsafe(ctx, deps, "admin"),
      }

      await handlers[test.handler]()

      expect(sm.transition).not.toHaveBeenCalled()
      const body = octokit.issues.createComment.mock.calls[0][0].body
      expect(body).toContain(test.expectedMessage)
    })
  }
})
