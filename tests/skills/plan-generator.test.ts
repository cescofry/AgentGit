import { describe, it, expect, vi } from "vitest"
import { PlanGeneratorSkill } from "../../src/skills/builtin/plan-generator"
import { ExecutionContext } from "../../src/skills/interface"
import { IssueContext, PlanResult, CodingHarness } from "../../src/harness/interface"
import { DEFAULT_CONFIG } from "../../src/config/defaults"

// ── Helpers ──

function makeIssueContext(overrides: Partial<IssueContext> = {}): IssueContext {
  return {
    issueNumber: 42,
    issueTitle: "Test issue",
    issueBody: "Test body",
    comments: [],
    labels: [],
    repoUrl: "https://github.com/test/repo",
    repoOwner: "test",
    repoName: "repo",
    ...overrides,
  }
}

function makePlanResult(overrides: Partial<PlanResult> = {}): PlanResult {
  return {
    plan: "## Step 1\nDo this\n\n## Step 2\nDo that",
    planVersion: 1,
    confidence: 0.85,
    warnings: [],
    ...overrides,
  }
}

function makeHarness(overrides: Partial<CodingHarness> = {}): CodingHarness {
  return {
    name: "test-harness",
    proposePlan: vi.fn().mockResolvedValue(makePlanResult()),
    revisePlan: vi.fn().mockResolvedValue(makePlanResult({ planVersion: 2 })),
    executePlan: vi.fn(),
    ...overrides,
  }
}

function makeContext(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    issueContext: makeIssueContext(),
    repoConfig: { ...DEFAULT_CONFIG },
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    },
    harness: makeHarness(),
    workspacePath: "/tmp/test",
    signingSecret: "test-secret",
    ...overrides,
  }
}

// ── Tests ──

describe("PlanGeneratorSkill", () => {
  const skill = new PlanGeneratorSkill()

  it("has correct name and description", () => {
    expect(skill.name).toBe("plan-generator")
    expect(skill.description).toBeTruthy()
  })

  describe("proposePlan", () => {
    it("calls harness.proposePlan with correct RepoConfig", async () => {
      const harness = makeHarness()
      const context = makeContext({ harness })

      const result = await skill.execute(
        {
          issue_context: context.issueContext,
          task_type: "bug",
          instructions: "Fix the bug",
        },
        context,
      )

      expect(result.success).toBe(true)
      expect(harness.proposePlan).toHaveBeenCalledOnce()

      const [passedIssue, passedConfig] = (harness.proposePlan as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(passedIssue).toEqual(context.issueContext)
      expect(passedConfig.taskType).toBe("bug")
      expect(passedConfig.instructions).toBe("Fix the bug")
      expect(passedConfig.maxRuntimeMinutes).toBe(DEFAULT_CONFIG.execution.max_runtime_minutes)
      expect(passedConfig.branchPrefix).toBe(DEFAULT_CONFIG.execution.branch_prefix)
    })

    it("returns plan data on success", async () => {
      const planResult = makePlanResult({
        plan: "My detailed plan",
        planVersion: 1,
        confidence: 0.9,
        warnings: ["minor concern"],
      })
      const harness = makeHarness({
        proposePlan: vi.fn().mockResolvedValue(planResult),
      })
      const context = makeContext({ harness })

      const result = await skill.execute(
        { task_type: "feature", instructions: "Build it" },
        context,
      )

      expect(result.success).toBe(true)
      expect(result.data.plan).toBe("My detailed plan")
      expect(result.data.plan_version).toBe(1)
      expect(result.data.confidence).toBe(0.9)
      expect(result.data.revised).toBe(false)
      expect(result.warnings).toContain("minor concern")
    })

    it("omits testCommand when execution.test_command is 'auto'", async () => {
      const harness = makeHarness()
      const config = { ...DEFAULT_CONFIG, execution: { ...DEFAULT_CONFIG.execution, test_command: "auto" } }
      const context = makeContext({ harness, repoConfig: config })

      await skill.execute(
        { task_type: "feature", instructions: "Build it" },
        context,
      )

      const [, passedConfig] = (harness.proposePlan as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(passedConfig.testCommand).toBeUndefined()
    })

    it("passes testCommand when execution.test_command is explicit", async () => {
      const harness = makeHarness()
      const config = {
        ...DEFAULT_CONFIG,
        execution: { ...DEFAULT_CONFIG.execution, test_command: "npm test" },
      }
      const context = makeContext({ harness, repoConfig: config })

      await skill.execute(
        { task_type: "feature", instructions: "Build it" },
        context,
      )

      const [, passedConfig] = (harness.proposePlan as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(passedConfig.testCommand).toBe("npm test")
    })

    it("returns error on harness failure", async () => {
      const harness = makeHarness({
        proposePlan: vi.fn().mockRejectedValue(new Error("LLM timeout")),
      })
      const context = makeContext({ harness })

      const result = await skill.execute(
        { task_type: "feature", instructions: "Build it" },
        context,
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain("Plan generation failed")
      expect(result.error).toContain("LLM timeout")
      expect(result.data).toEqual({})
    })

    it("defaults task_type to feature when not provided", async () => {
      const harness = makeHarness()
      const context = makeContext({ harness })

      await skill.execute({ instructions: "Do something" }, context)

      const [, passedConfig] = (harness.proposePlan as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(passedConfig.taskType).toBe("feature")
    })
  })

  describe("revisePlan", () => {
    it("calls harness.revisePlan when prior_plan and feedback are present", async () => {
      const revisedPlan = makePlanResult({
        plan: "Revised plan",
        planVersion: 2,
        confidence: 0.95,
        warnings: [],
      })
      const harness = makeHarness({
        revisePlan: vi.fn().mockResolvedValue(revisedPlan),
      })
      const context = makeContext({ harness })

      const result = await skill.execute(
        {
          task_type: "bug",
          instructions: "Fix the bug",
          prior_plan: "Original plan",
          feedback: "Please also handle edge cases",
        },
        context,
      )

      expect(result.success).toBe(true)
      expect(result.data.plan).toBe("Revised plan")
      expect(result.data.plan_version).toBe(2)
      expect(result.data.revised).toBe(true)
      expect(harness.revisePlan).toHaveBeenCalledOnce()
      expect(harness.proposePlan).not.toHaveBeenCalled()

      const [passedIssue, passedPrior, passedFeedback, passedConfig] =
        (harness.revisePlan as ReturnType<typeof vi.fn>).mock.calls[0]
      expect(passedIssue).toEqual(context.issueContext)
      expect(passedPrior).toBe("Original plan")
      expect(passedFeedback).toBe("Please also handle edge cases")
      expect(passedConfig.taskType).toBe("bug")
    })

    it("does not revise when only prior_plan is present (no feedback)", async () => {
      const harness = makeHarness()
      const context = makeContext({ harness })

      await skill.execute(
        {
          task_type: "feature",
          instructions: "Build it",
          prior_plan: "Original plan",
        },
        context,
      )

      expect(harness.proposePlan).toHaveBeenCalledOnce()
      expect(harness.revisePlan).not.toHaveBeenCalled()
    })

    it("returns error on revision failure", async () => {
      const harness = makeHarness({
        revisePlan: vi.fn().mockRejectedValue(new Error("Context too long")),
      })
      const context = makeContext({ harness })

      const result = await skill.execute(
        {
          task_type: "bug",
          instructions: "Fix the bug",
          prior_plan: "Original plan",
          feedback: "Try again",
        },
        context,
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain("Plan generation failed")
      expect(result.error).toContain("Context too long")
    })
  })
})
