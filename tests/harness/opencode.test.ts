import { describe, it, expect, vi } from "vitest"
import {
  buildIssuePrompt,
  parsePlanOutput,
  parseExecutionOutput,
  shellEscape,
  OpenCodeHarness,
} from "../../src/harness/opencode"
import { IssueContext, RepoConfig } from "../../src/harness/interface"

// ── Fixtures ──

function makeIssueContext(overrides?: Partial<IssueContext>): IssueContext {
  return {
    issueNumber: 42,
    issueTitle: "Fix login bug",
    issueBody: "The login form crashes when the password is empty.",
    comments: [],
    labels: ["bug"],
    repoUrl: "https://github.com/acme/app",
    repoOwner: "acme",
    repoName: "app",
    ...overrides,
  }
}

function makeRepoConfig(overrides?: Partial<RepoConfig>): RepoConfig {
  return {
    taskType: "bug",
    instructions: "Fix the bug following existing patterns.",
    testCommand: "npm test",
    maxRuntimeMinutes: 30,
    branchPrefix: "agent/",
    ...overrides,
  }
}

// ── Tests ──

describe("OpenCodeHarness", () => {
  describe("buildIssuePrompt", () => {
    it("includes issue number, title, and body", () => {
      const issue = makeIssueContext()
      const config = makeRepoConfig()
      const prompt = buildIssuePrompt(issue, config)

      expect(prompt).toContain("Issue #42: Fix login bug")
      expect(prompt).toContain(
        "The login form crashes when the password is empty.",
      )
    })

    it("includes repo owner and name", () => {
      const issue = makeIssueContext()
      const config = makeRepoConfig()
      const prompt = buildIssuePrompt(issue, config)

      expect(prompt).toContain("Repository: acme/app")
    })

    it("includes comments when present", () => {
      const issue = makeIssueContext({
        comments: [
          {
            author: "alice",
            body: "I can reproduce this on Chrome.",
            createdAt: "2026-06-01T10:00:00Z",
          },
          {
            author: "bob",
            body: "Same here on Firefox.",
            createdAt: "2026-06-01T11:00:00Z",
          },
        ],
      })
      const config = makeRepoConfig()
      const prompt = buildIssuePrompt(issue, config)

      expect(prompt).toContain("Discussion")
      expect(prompt).toContain("@alice")
      expect(prompt).toContain("I can reproduce this on Chrome.")
      expect(prompt).toContain("@bob")
      expect(prompt).toContain("Same here on Firefox.")
    })

    it("omits discussion section when no comments", () => {
      const issue = makeIssueContext({ comments: [] })
      const config = makeRepoConfig()
      const prompt = buildIssuePrompt(issue, config)

      expect(prompt).not.toContain("Discussion")
    })

    it("includes labels", () => {
      const issue = makeIssueContext({ labels: ["bug", "priority:high"] })
      const config = makeRepoConfig()
      const prompt = buildIssuePrompt(issue, config)

      expect(prompt).toContain("Labels: bug, priority:high")
    })

    it("includes task type from config", () => {
      const issue = makeIssueContext()
      const config = makeRepoConfig({ taskType: "feature" })
      const prompt = buildIssuePrompt(issue, config)

      expect(prompt).toContain("Task type: feature")
    })

    it("includes instructions from config", () => {
      const issue = makeIssueContext()
      const config = makeRepoConfig({
        instructions: "Follow TDD approach.",
      })
      const prompt = buildIssuePrompt(issue, config)

      expect(prompt).toContain("Instructions")
      expect(prompt).toContain("Follow TDD approach.")
    })

    it("includes test command when provided", () => {
      const issue = makeIssueContext()
      const config = makeRepoConfig({ testCommand: "yarn test:ci" })
      const prompt = buildIssuePrompt(issue, config)

      expect(prompt).toContain("Test command: yarn test:ci")
    })

    it("omits test command when not provided", () => {
      const issue = makeIssueContext()
      const config = makeRepoConfig({ testCommand: undefined })
      const prompt = buildIssuePrompt(issue, config)

      expect(prompt).not.toContain("Test command:")
    })
  })

  describe("parsePlanOutput", () => {
    it("returns trimmed plan text", () => {
      const result = parsePlanOutput("  ## Plan\n\nDo things.  \n", 1)
      expect(result.plan).toBe("## Plan\n\nDo things.")
    })

    it("sets the provided version number", () => {
      const result = parsePlanOutput("plan text", 3)
      expect(result.planVersion).toBe(3)
    })

    it("extracts confidence when present", () => {
      const result = parsePlanOutput("Plan text.\nconfidence: 0.85\nMore.", 1)
      expect(result.confidence).toBe(0.85)
    })

    it("defaults confidence to 0.7 when not present", () => {
      const result = parsePlanOutput("Plan text without confidence.", 1)
      expect(result.confidence).toBe(0.7)
    })

    it("extracts warning lines", () => {
      const output =
        "Plan text.\nWarning: dependency X is deprecated.\nMore plan."
      const result = parsePlanOutput(output, 1)
      expect(result.warnings).toHaveLength(1)
      expect(result.warnings[0]).toContain("dependency X is deprecated")
    })

    it("returns empty warnings when none present", () => {
      const result = parsePlanOutput("Clean plan text.", 1)
      expect(result.warnings).toEqual([])
    })
  })

  describe("parseExecutionOutput", () => {
    it("returns success when no errors", () => {
      const result = parseExecutionOutput(
        "Changes applied successfully.",
        "agent/issue-42",
      )
      expect(result.success).toBe(true)
      expect(result.errors).toEqual([])
    })

    it("returns the provided branch", () => {
      const result = parseExecutionOutput("output", "agent/issue-42")
      expect(result.branch).toBe("agent/issue-42")
    })

    it("detects error lines", () => {
      const output = "Starting.\nError: file not found.\nDone."
      const result = parseExecutionOutput(output, "agent/issue-42")
      expect(result.success).toBe(false)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toContain("file not found")
    })

    it("extracts PR URL when present", () => {
      const output =
        "PR opened: https://github.com/acme/app/pull/99\nDone."
      const result = parseExecutionOutput(output, "agent/issue-42")
      expect(result.prUrl).toBe("https://github.com/acme/app/pull/99")
    })

    it("returns undefined prUrl when not present", () => {
      const result = parseExecutionOutput("No PR.", "agent/issue-42")
      expect(result.prUrl).toBeUndefined()
    })

    it("returns trimmed diff summary", () => {
      const result = parseExecutionOutput("  summary  \n", "agent/issue-42")
      expect(result.diffSummary).toBe("summary")
    })
  })

  describe("shellEscape", () => {
    it("wraps simple strings in single quotes", () => {
      expect(shellEscape("hello")).toBe("'hello'")
    })

    it("escapes single quotes within strings", () => {
      expect(shellEscape("it's fine")).toBe("'it'\\''s fine'")
    })

    it("handles empty string", () => {
      expect(shellEscape("")).toBe("''")
    })

    it("handles strings with special shell characters", () => {
      const result = shellEscape("$HOME && rm -rf /")
      expect(result).toBe("'$HOME && rm -rf /'")
    })
  })

  describe("proposePlan", () => {
    it("catches errors and returns a result with warnings", async () => {
      // execSync will fail since opencode CLI is not installed in test env
      const harness = new OpenCodeHarness("test-model")
      const issue = makeIssueContext()
      const config = makeRepoConfig()

      const result = await harness.proposePlan(issue, config)

      // It should not throw, but return a failed result
      expect(result.plan).toBe("")
      expect(result.confidence).toBe(0)
      expect(result.warnings.length).toBeGreaterThan(0)
      expect(result.warnings[0]).toContain("OpenCode plan generation failed")
    })
  })

  describe("revisePlan", () => {
    it("catches errors and returns a result with warnings", async () => {
      const harness = new OpenCodeHarness("test-model")
      const issue = makeIssueContext()
      const config = makeRepoConfig()

      const result = await harness.revisePlan(
        issue,
        "## Prior Plan (v2)\nDo things.",
        "Add more tests",
        config,
      )

      expect(result.plan).toBe("")
      expect(result.planVersion).toBe(3) // v2 + 1
      expect(result.warnings.length).toBeGreaterThan(0)
      expect(result.warnings[0]).toContain("OpenCode plan revision failed")
    })

    it("defaults to version 2 when prior plan has no version marker", async () => {
      const harness = new OpenCodeHarness()
      const issue = makeIssueContext()
      const config = makeRepoConfig()

      const result = await harness.revisePlan(
        issue,
        "A plan with no version marker.",
        "feedback",
        config,
      )

      expect(result.planVersion).toBe(2) // default 1 + 1
    })
  })

  describe("executePlan", () => {
    it("catches errors and returns a failed result", async () => {
      const harness = new OpenCodeHarness("test-model")
      const issue = makeIssueContext()
      const config = makeRepoConfig()

      const result = await harness.executePlan(
        issue,
        "## Plan\nStep 1: Do things.",
        "/tmp/fake-workspace",
        config,
      )

      expect(result.success).toBe(false)
      expect(result.branch).toBe("agent/issue-42")
      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors[0]).toContain("OpenCode execution failed")
    })

    it("constructs the branch name from config prefix and issue number", async () => {
      const harness = new OpenCodeHarness()
      const issue = makeIssueContext({ issueNumber: 99 })
      const config = makeRepoConfig({ branchPrefix: "bot/" })

      const result = await harness.executePlan(
        issue,
        "plan",
        "/tmp/ws",
        config,
      )

      expect(result.branch).toBe("bot/issue-99")
    })
  })

  describe("PiHarness", () => {
    it("throws on all methods", async () => {
      // Quick sanity check that the stub throws
      const { PiHarness } = await import("../../src/harness/pi")
      const harness = new PiHarness()
      const issue = makeIssueContext()
      const config = makeRepoConfig()

      await expect(harness.proposePlan(issue, config)).rejects.toThrow(
        "Pi harness not yet implemented",
      )
      await expect(
        harness.revisePlan(issue, "plan", "feedback", config),
      ).rejects.toThrow("Pi harness not yet implemented")
      await expect(
        harness.executePlan(issue, "plan", "/ws", config),
      ).rejects.toThrow("Pi harness not yet implemented")
    })
  })
})
