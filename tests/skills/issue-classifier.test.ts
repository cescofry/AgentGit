import { describe, it, expect, vi } from "vitest"
import { IssueClassifierSkill } from "../../src/skills/builtin/issue-classifier"
import { ExecutionContext } from "../../src/skills/interface"
import { IssueContext } from "../../src/harness/interface"
import { AgentGitConfig, DEFAULT_CONFIG } from "../../src/config/defaults"

// ── Helpers ──

function makeIssueContext(overrides: Partial<IssueContext> = {}): IssueContext {
  return {
    issueNumber: 42,
    issueTitle: "Some issue",
    issueBody: "Description of the issue.",
    comments: [],
    labels: [],
    repoUrl: "https://github.com/test/repo",
    repoOwner: "test",
    repoName: "repo",
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
    harness: {
      name: "test-harness",
      proposePlan: vi.fn(),
      revisePlan: vi.fn(),
      executePlan: vi.fn(),
    },
    workspacePath: "/tmp/test",
    signingSecret: "test-secret",
    ...overrides,
  }
}

// ── Tests ──

describe("IssueClassifierSkill", () => {
  const skill = new IssueClassifierSkill()

  it("has correct name and description", () => {
    expect(skill.name).toBe("issue-classifier")
    expect(skill.description).toBeTruthy()
  })

  describe("label-based classification", () => {
    it("classifies issue with 'bug' label as bug", async () => {
      const context = makeContext({
        issueContext: makeIssueContext({ labels: ["bug"] }),
      })

      const result = await skill.execute({ issue_context: context.issueContext }, context)

      expect(result.success).toBe(true)
      expect(result.data.task_type).toBe("bug")
      expect(result.data.instructions).toContain("Fix the reported bug")
    })

    it("classifies issue with 'enhancement' label as feature", async () => {
      const context = makeContext({
        issueContext: makeIssueContext({ labels: ["enhancement"] }),
      })

      const result = await skill.execute({ issue_context: context.issueContext }, context)

      expect(result.success).toBe(true)
      expect(result.data.task_type).toBe("feature")
      expect(result.data.instructions).toContain("Implement the requested feature")
    })

    it("classifies issue with 'documentation' label as docs", async () => {
      const context = makeContext({
        issueContext: makeIssueContext({ labels: ["documentation"] }),
      })

      const result = await skill.execute({ issue_context: context.issueContext }, context)

      expect(result.success).toBe(true)
      expect(result.data.task_type).toBe("docs")
      expect(result.data.instructions).toContain("Update documentation")
    })

    it("classifies issue with 'ui' label as ui", async () => {
      const context = makeContext({
        issueContext: makeIssueContext({ labels: ["ui"] }),
      })

      const result = await skill.execute({ issue_context: context.issueContext }, context)

      expect(result.success).toBe(true)
      expect(result.data.task_type).toBe("ui")
      expect(result.data.instructions).toContain("UI changes")
    })

    it("uses agent:type:bug label", async () => {
      const context = makeContext({
        issueContext: makeIssueContext({ labels: ["agent:type:bug"] }),
      })

      const result = await skill.execute({ issue_context: context.issueContext }, context)

      expect(result.success).toBe(true)
      expect(result.data.task_type).toBe("bug")
    })

    it("uses first match when multiple labels match different types", async () => {
      // In DEFAULT_CONFIG, bug comes before feature in task_types order
      const context = makeContext({
        issueContext: makeIssueContext({ labels: ["bug", "enhancement"] }),
      })

      const result = await skill.execute({ issue_context: context.issueContext }, context)

      expect(result.success).toBe(true)
      expect(result.data.task_type).toBe("bug")
    })

    it("is case-insensitive for label matching", async () => {
      const context = makeContext({
        issueContext: makeIssueContext({ labels: ["BUG"] }),
      })

      const result = await skill.execute({ issue_context: context.issueContext }, context)

      expect(result.success).toBe(true)
      expect(result.data.task_type).toBe("bug")
    })
  })

  describe("keyword-based classification", () => {
    it("classifies issue with 'fix' in title as bug when no matching label", async () => {
      const context = makeContext({
        issueContext: makeIssueContext({
          labels: ["priority:high"],
          issueTitle: "Fix the broken login page",
        }),
      })

      const result = await skill.execute({ issue_context: context.issueContext }, context)

      expect(result.success).toBe(true)
      expect(result.data.task_type).toBe("bug")
    })

    it("classifies issue with 'error' in body as bug", async () => {
      const context = makeContext({
        issueContext: makeIssueContext({
          labels: [],
          issueTitle: "Something is wrong",
          issueBody: "There is an error when submitting the form.",
        }),
      })

      const result = await skill.execute({ issue_context: context.issueContext }, context)

      expect(result.success).toBe(true)
      expect(result.data.task_type).toBe("bug")
    })

    it("classifies issue with 'implement' in title as feature", async () => {
      const context = makeContext({
        issueContext: makeIssueContext({
          labels: [],
          issueTitle: "Implement dark mode support",
        }),
      })

      const result = await skill.execute({ issue_context: context.issueContext }, context)

      expect(result.success).toBe(true)
      expect(result.data.task_type).toBe("feature")
    })

    it("classifies issue with 'readme' in body as docs", async () => {
      const context = makeContext({
        issueContext: makeIssueContext({
          labels: [],
          issueTitle: "Needs update",
          issueBody: "The readme is out of date.",
        }),
      })

      const result = await skill.execute({ issue_context: context.issueContext }, context)

      expect(result.success).toBe(true)
      expect(result.data.task_type).toBe("docs")
    })

    it("classifies issue with 'component' in title as ui", async () => {
      const context = makeContext({
        issueContext: makeIssueContext({
          labels: [],
          issueTitle: "Refactor the button component",
        }),
      })

      const result = await skill.execute({ issue_context: context.issueContext }, context)

      expect(result.success).toBe(true)
      expect(result.data.task_type).toBe("ui")
    })
  })

  describe("default classification", () => {
    it("defaults to feature when no label or keyword matches", async () => {
      const context = makeContext({
        issueContext: makeIssueContext({
          labels: ["priority:low"],
          issueTitle: "Something about the system",
          issueBody: "Please look at this.",
        }),
      })

      const result = await skill.execute({ issue_context: context.issueContext }, context)

      expect(result.success).toBe(true)
      expect(result.data.task_type).toBe("feature")
      expect(result.warnings.length).toBeGreaterThan(0)
      expect(result.warnings[0]).toContain("defaulting")
    })
  })

  describe("instructions", () => {
    it("returns bug instructions for bug type", async () => {
      const context = makeContext({
        issueContext: makeIssueContext({ labels: ["bug"] }),
      })

      const result = await skill.execute({ issue_context: context.issueContext }, context)

      expect(result.data.instructions).toBe(
        "Fix the reported bug. Identify root cause, implement fix, add regression tests.",
      )
    })

    it("returns feature instructions for feature type", async () => {
      const context = makeContext({
        issueContext: makeIssueContext({ labels: ["enhancement"] }),
      })

      const result = await skill.execute({ issue_context: context.issueContext }, context)

      expect(result.data.instructions).toBe(
        "Implement the requested feature. Follow existing code patterns, add tests.",
      )
    })

    it("returns docs instructions for docs type", async () => {
      const context = makeContext({
        issueContext: makeIssueContext({ labels: ["documentation"] }),
      })

      const result = await skill.execute({ issue_context: context.issueContext }, context)

      expect(result.data.instructions).toBe(
        "Update documentation as requested. Ensure accuracy and completeness.",
      )
    })

    it("returns ui instructions for ui type", async () => {
      const context = makeContext({
        issueContext: makeIssueContext({ labels: ["ui"] }),
      })

      const result = await skill.execute({ issue_context: context.issueContext }, context)

      expect(result.data.instructions).toBe(
        "Implement the UI changes as described. Match existing styling patterns.",
      )
    })
  })

  describe("custom task_types input", () => {
    it("uses task_types from input when provided", async () => {
      const context = makeContext({
        issueContext: makeIssueContext({ labels: ["perf"] }),
      })

      const customTaskTypes = {
        performance: { labels: ["perf", "performance"] },
      }

      const result = await skill.execute(
        { issue_context: context.issueContext, task_types: customTaskTypes },
        context,
      )

      expect(result.success).toBe(true)
      expect(result.data.task_type).toBe("performance")
    })
  })
})
