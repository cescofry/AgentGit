import { describe, it, expect, vi, beforeEach } from "vitest"
import { createStateManager, OctokitLike } from "../../src/state/manager"
import { ALL_LABELS } from "../../src/state/labels"

/**
 * Create a mock Octokit with controllable label state.
 * `issueLabels` is the list of label names currently on the issue.
 * `repoLabels` is the set of label names that exist on the repo.
 */
function createMockOctokit(issueLabels: string[], repoLabels: Set<string>): OctokitLike {
  return {
    rest: {
      issues: {
        listLabelsOnIssue: vi.fn(async () => ({
          data: issueLabels.map((name) => ({ name })),
        })),
        addLabels: vi.fn(async ({ labels }: { labels: string[] }) => {
          for (const l of labels) {
            if (!issueLabels.includes(l)) {
              issueLabels.push(l)
            }
          }
        }),
        removeLabel: vi.fn(async ({ name }: { name: string }) => {
          const idx = issueLabels.indexOf(name)
          if (idx === -1) {
            throw new Error(`Label "${name}" not found on issue`)
          }
          issueLabels.splice(idx, 1)
        }),
      },
      repos: {
        getLabel: vi.fn(async ({ name }: { name: string }) => {
          if (!repoLabels.has(name)) {
            throw new Error(`Label "${name}" not found`)
          }
          return { data: { name } }
        }),
        createLabel: vi.fn(async ({ name }: { name: string }) => {
          repoLabels.add(name)
        }),
      },
    },
  }
}

describe("StateManager", () => {
  const owner = "test-owner"
  const repo = "test-repo"
  const issueNumber = 42

  describe("getCurrentState", () => {
    it("fetches labels and returns correct state", async () => {
      const octokit = createMockOctokit(["bug", "agent:planning", "agent:type:feature"], new Set())
      const manager = createStateManager()

      const state = await manager.getCurrentState(octokit, owner, repo, issueNumber)

      expect(state).toBe("agent:planning")
      expect(octokit.rest.issues.listLabelsOnIssue).toHaveBeenCalledWith({
        owner,
        repo,
        issue_number: issueNumber,
      })
    })

    it("returns null when no state labels are present", async () => {
      const octokit = createMockOctokit(["bug", "enhancement"], new Set())
      const manager = createStateManager()

      const state = await manager.getCurrentState(octokit, owner, repo, issueNumber)

      expect(state).toBeNull()
    })

    it("returns null for an issue with no labels at all", async () => {
      const octokit = createMockOctokit([], new Set())
      const manager = createStateManager()

      const state = await manager.getCurrentState(octokit, owner, repo, issueNumber)

      expect(state).toBeNull()
    })
  })

  describe("transition", () => {
    it("removes old state label and adds new one on valid transition", async () => {
      const issueLabels = ["agent:ready", "agent:type:bug"]
      const octokit = createMockOctokit(issueLabels, new Set())
      const manager = createStateManager()

      const result = await manager.transition(octokit, owner, repo, issueNumber, "plan_requested")

      expect(result.valid).toBe(true)
      expect(result.from).toBe("agent:ready")
      expect(result.to).toBe("agent:security-review")

      // Old label removed
      expect(octokit.rest.issues.removeLabel).toHaveBeenCalledWith({
        owner,
        repo,
        issue_number: issueNumber,
        name: "agent:ready",
      })

      // New label added
      expect(octokit.rest.issues.addLabels).toHaveBeenCalledWith({
        owner,
        repo,
        issue_number: issueNumber,
        labels: ["agent:security-review"],
      })

      // Classification label preserved
      expect(issueLabels).toContain("agent:type:bug")
      expect(issueLabels).toContain("agent:security-review")
      expect(issueLabels).not.toContain("agent:ready")
    })

    it("transitions from null state (no previous label to remove)", async () => {
      const issueLabels = ["bug"]
      const octokit = createMockOctokit(issueLabels, new Set())
      const manager = createStateManager()

      const result = await manager.transition(octokit, owner, repo, issueNumber, "plan_requested")

      expect(result.valid).toBe(true)
      expect(result.from).toBeNull()
      expect(result.to).toBe("agent:security-review")

      // Should NOT have called removeLabel (no old state label)
      expect(octokit.rest.issues.removeLabel).not.toHaveBeenCalled()

      // New label added
      expect(octokit.rest.issues.addLabels).toHaveBeenCalledWith({
        owner,
        repo,
        issue_number: issueNumber,
        labels: ["agent:security-review"],
      })
    })

    it("transitions to null state (close_unsafe removes label, no new one)", async () => {
      const issueLabels = ["agent:locked-security"]
      const octokit = createMockOctokit(issueLabels, new Set())
      const manager = createStateManager()

      const result = await manager.transition(octokit, owner, repo, issueNumber, "close_unsafe")

      expect(result.valid).toBe(true)
      expect(result.from).toBe("agent:locked-security")
      expect(result.to).toBeNull()

      // Old label removed
      expect(octokit.rest.issues.removeLabel).toHaveBeenCalledWith({
        owner,
        repo,
        issue_number: issueNumber,
        name: "agent:locked-security",
      })

      // No new label added
      expect(octokit.rest.issues.addLabels).not.toHaveBeenCalled()
    })

    it("returns invalid and does not change labels for invalid transition", async () => {
      const issueLabels = ["agent:done", "agent:type:feature"]
      const octokit = createMockOctokit(issueLabels, new Set())
      const manager = createStateManager()

      const result = await manager.transition(octokit, owner, repo, issueNumber, "plan_completed")

      expect(result.valid).toBe(false)
      expect(result.reason).toBeDefined()

      // Should not have modified labels
      expect(octokit.rest.issues.removeLabel).not.toHaveBeenCalled()
      expect(octokit.rest.issues.addLabels).not.toHaveBeenCalled()

      // Labels unchanged
      expect(issueLabels).toEqual(["agent:done", "agent:type:feature"])
    })

    it("handles full lifecycle: null -> security-review -> planning -> plan-review -> approved -> working -> pr-opened -> done", async () => {
      const issueLabels: string[] = []
      const octokit = createMockOctokit(issueLabels, new Set())
      const manager = createStateManager()

      const steps: Array<{ trigger: any; expectedTo: string | null }> = [
        { trigger: "plan_requested", expectedTo: "agent:security-review" },
        { trigger: "security_review_passed", expectedTo: "agent:planning" },
        { trigger: "plan_completed", expectedTo: "agent:plan-review" },
        { trigger: "plan_approved", expectedTo: "agent:approved" },
        { trigger: "work_started", expectedTo: "agent:working" },
        { trigger: "build_completed", expectedTo: "agent:pr-opened" },
        { trigger: "pr_merged", expectedTo: "agent:done" },
      ]

      for (const step of steps) {
        const result = await manager.transition(octokit, owner, repo, issueNumber, step.trigger)
        expect(result.valid).toBe(true)
        expect(result.to).toBe(step.expectedTo)
      }
    })
  })

  describe("ensureLabel", () => {
    it("does not create label if it already exists", async () => {
      const repoLabels = new Set(["agent:ready"])
      const octokit = createMockOctokit([], repoLabels)
      const manager = createStateManager()

      const label = ALL_LABELS.find((l) => l.name === "agent:ready")!
      await manager.ensureLabel(octokit, owner, repo, label)

      expect(octokit.rest.repos.getLabel).toHaveBeenCalledWith({
        owner,
        repo,
        name: "agent:ready",
      })
      expect(octokit.rest.repos.createLabel).not.toHaveBeenCalled()
    })

    it("creates label if it does not exist", async () => {
      const repoLabels = new Set<string>()
      const octokit = createMockOctokit([], repoLabels)
      const manager = createStateManager()

      const label = ALL_LABELS.find((l) => l.name === "agent:ready")!
      await manager.ensureLabel(octokit, owner, repo, label)

      expect(octokit.rest.repos.createLabel).toHaveBeenCalledWith({
        owner,
        repo,
        name: label.name,
        color: label.color,
        description: label.description,
      })
      expect(repoLabels.has("agent:ready")).toBe(true)
    })
  })

  describe("ensureAllLabels", () => {
    it("creates all missing labels", async () => {
      const repoLabels = new Set<string>()
      const octokit = createMockOctokit([], repoLabels)
      const manager = createStateManager()

      await manager.ensureAllLabels(octokit, owner, repo)

      // All labels should now exist in the repo
      for (const label of ALL_LABELS) {
        expect(repoLabels.has(label.name)).toBe(true)
      }

      // createLabel should have been called for each label
      expect(octokit.rest.repos.createLabel).toHaveBeenCalledTimes(ALL_LABELS.length)
    })

    it("skips labels that already exist", async () => {
      // Pre-populate some labels
      const existingNames = ALL_LABELS.slice(0, 5).map((l) => l.name)
      const repoLabels = new Set(existingNames)
      const octokit = createMockOctokit([], repoLabels)
      const manager = createStateManager()

      await manager.ensureAllLabels(octokit, owner, repo)

      // createLabel should only be called for the missing ones
      const expectedCreations = ALL_LABELS.length - existingNames.length
      expect(octokit.rest.repos.createLabel).toHaveBeenCalledTimes(expectedCreations)

      // All labels should exist
      for (const label of ALL_LABELS) {
        expect(repoLabels.has(label.name)).toBe(true)
      }
    })
  })
})
