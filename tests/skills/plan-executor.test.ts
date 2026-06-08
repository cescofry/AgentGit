import { describe, it, expect, vi, beforeEach } from "vitest"
import { PlanExecutorSkill } from "../../src/skills/builtin/plan-executor"
import { ExecutionContext, SkillInput } from "../../src/skills/interface"
import { createLogger } from "../../src/utils/logger"
import { DEFAULT_CONFIG } from "../../src/config/defaults"

describe("PlanExecutorSkill", () => {
  let skill: PlanExecutorSkill
  let context: ExecutionContext
  let mockExecutePlan: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()

    skill = new PlanExecutorSkill()

    mockExecutePlan = vi.fn().mockResolvedValue({
      success: true,
      branch: "agent/issue-42",
      prUrl: "https://github.com/owner/repo/pull/1",
      diffSummary: "Modified 3 files",
      testResults: "All tests passed",
      errors: [],
    })

    context = {
      issueContext: {
        issueNumber: 42,
        issueTitle: "Fix the bug",
        issueBody: "There is a bug",
        comments: [],
        labels: ["bug"],
        repoUrl: "https://github.com/owner/repo",
        repoOwner: "owner",
        repoName: "repo",
      },
      repoConfig: { ...DEFAULT_CONFIG },
      logger: createLogger("error"),
      harness: {
        name: "mock-harness",
        proposePlan: vi.fn(),
        revisePlan: vi.fn(),
        executePlan: mockExecutePlan,
      },
      workspacePath: "/tmp/agentgit/repo/issue-42",
      signingSecret: "test-secret",
    }
  })

  it("has correct name and description", () => {
    expect(skill.name).toBe("plan-executor")
    expect(skill.description).toContain("coding harness")
  })

  it("calls harness.executePlan with correct args", async () => {
    const input: SkillInput = {
      approved_plan: "1. Fix the bug\n2. Add tests",
      workspace: "/tmp/agentgit/repo/issue-42",
    }

    const result = await skill.execute(input, context)

    expect(result.success).toBe(true)
    expect(mockExecutePlan).toHaveBeenCalledTimes(1)

    const [issueCtx, plan, workspace, repoConfig] = mockExecutePlan.mock.calls[0]
    expect(issueCtx.issueNumber).toBe(42)
    expect(plan).toBe("1. Fix the bug\n2. Add tests")
    expect(workspace).toBe("/tmp/agentgit/repo/issue-42")
    expect(repoConfig).toBeDefined()
  })

  it("returns execution result data", async () => {
    const input: SkillInput = {
      approved_plan: "Do the thing",
      workspace: "/tmp/workspace",
    }

    const result = await skill.execute(input, context)

    expect(result.success).toBe(true)
    expect(result.data.branch).toBe("agent/issue-42")
    expect(result.data.pr_url).toBe("https://github.com/owner/repo/pull/1")
    expect(result.data.diff_summary).toBe("Modified 3 files")
    expect(result.data.test_results).toBe("All tests passed")
    expect(result.data.errors).toEqual([])
  })

  it("returns error when approved_plan is missing", async () => {
    const result = await skill.execute({ workspace: "/tmp" }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain("Missing required input: approved_plan")
  })

  it("returns error when workspace is missing", async () => {
    const result = await skill.execute({ approved_plan: "plan" }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain("Missing required input: workspace")
  })

  it("handles harness execution failure", async () => {
    mockExecutePlan.mockResolvedValue({
      success: false,
      branch: "agent/issue-42",
      diffSummary: "",
      errors: ["Compilation error", "Test failure"],
    })

    const input: SkillInput = {
      approved_plan: "plan",
      workspace: "/tmp/workspace",
    }

    const result = await skill.execute(input, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain("Compilation error")
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it("handles harness throwing an exception", async () => {
    mockExecutePlan.mockRejectedValue(new Error("harness crashed"))

    const input: SkillInput = {
      approved_plan: "plan",
      workspace: "/tmp/workspace",
    }

    const result = await skill.execute(input, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain("harness crashed")
  })
})
