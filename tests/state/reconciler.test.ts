import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createReconciler, ReconcilerConfig, ReconcilerOctokit } from "../../src/state/reconciler"
import { createLogger } from "../../src/utils/logger"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: ReconcilerConfig = {
  intervalMs: 10 * 60 * 1000,
  staleThresholdMs: 30 * 60 * 1000,
  appSlug: "test-agent-bot",
  signingSecret: "test-secret-key",
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString()
}

/**
 * Build a mock ReconcilerOctokit.
 *
 * `repos` – list of { owner, name } to return from listInstallations / listRepos
 * `issues` – keyed by `owner/repo`, each entry is an array of issues with their labels
 * `comments` – keyed by `owner/repo#number`, each entry is an array of comment objects
 */
function createMockOctokit(opts: {
  repos?: Array<{ owner: string; name: string }>
  issues?: Record<
    string,
    Array<{
      number: number
      updated_at: string
      labels: Array<{ name: string }>
    }>
  >
  comments?: Record<
    string,
    Array<{
      id: number
      body?: string
      created_at: string
      performed_via_github_app?: { slug: string } | null
    }>
  >
  /** Per-issue label arrays – mutated by addLabels / removeLabel */
  issueLabels?: Record<string, string[]>
}): ReconcilerOctokit {
  const repos = opts.repos ?? []
  const issues = opts.issues ?? {}
  const comments = opts.comments ?? {}
  const issueLabels = opts.issueLabels ?? {}

  return {
    rest: {
      apps: {
        listInstallations: vi.fn(async () => ({
          data: [{ id: 1 }],
        })),
        listReposAccessibleToInstallation: vi.fn(async () => ({
          data: {
            repositories: repos.map((r) => ({
              owner: { login: r.owner },
              name: r.name,
            })),
          },
        })),
      },
      issues: {
        listForRepo: vi.fn(async ({ owner, repo, labels }: any) => {
          const key = `${owner}/${repo}`
          const all = issues[key] ?? []
          // Filter to issues that have the requested label
          return {
            data: all.filter((issue) =>
              issue.labels.some((l) => l.name === labels),
            ),
          }
        }),
        listComments: vi.fn(async ({ owner, repo, issue_number }: any) => {
          const key = `${owner}/${repo}#${issue_number}`
          return { data: comments[key] ?? [] }
        }),
        createComment: vi.fn(async () => ({})),
        listLabelsOnIssue: vi.fn(async ({ owner, repo, issue_number }: any) => {
          const key = `${owner}/${repo}#${issue_number}`
          const labels = issueLabels[key] ?? []
          return { data: labels.map((name: string) => ({ name })) }
        }),
        addLabels: vi.fn(async ({ owner, repo, issue_number, labels }: any) => {
          const key = `${owner}/${repo}#${issue_number}`
          if (!issueLabels[key]) issueLabels[key] = []
          for (const l of labels) {
            if (!issueLabels[key].includes(l)) {
              issueLabels[key].push(l)
            }
          }
        }),
        removeLabel: vi.fn(async ({ owner, repo, issue_number, name }: any) => {
          const key = `${owner}/${repo}#${issue_number}`
          if (!issueLabels[key]) return
          const idx = issueLabels[key].indexOf(name)
          if (idx !== -1) issueLabels[key].splice(idx, 1)
        }),
      },
      repos: {
        getLabel: vi.fn(async () => ({})),
        createLabel: vi.fn(async () => ({})),
      },
    },
  } as unknown as ReconcilerOctokit
}

const silentLogger = createLogger("error")

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Reconciler", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // -----------------------------------------------------------------------
  // Stale issue recovery
  // -----------------------------------------------------------------------

  describe("stale issue recovery", () => {
    it("stale agent:planning issue transitions to agent:blocked", async () => {
      const issueLabels = { "acme/app#10": ["agent:planning"] }
      const octokit = createMockOctokit({
        repos: [{ owner: "acme", name: "app" }],
        issues: {
          "acme/app": [
            {
              number: 10,
              updated_at: minutesAgo(60),
              labels: [{ name: "agent:planning" }],
            },
          ],
        },
        comments: {}, // no bot comments
        issueLabels,
      })

      const reconciler = createReconciler(() => octokit, DEFAULT_CONFIG, silentLogger)
      const result = await reconciler.reconcile()

      expect(result.issuesRecovered).toBe(1)
      expect(result.issuesChecked).toBeGreaterThanOrEqual(1)
      // The planning label should have been removed and blocked/cancelled added
      expect(issueLabels["acme/app#10"]).not.toContain("agent:planning")
      // A comment should have been posted
      expect(octokit.rest.issues.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          owner: "acme",
          repo: "app",
          issue_number: 10,
        }),
      )
    })

    it("fresh agent:planning issue is skipped", async () => {
      const issueLabels = { "acme/app#10": ["agent:planning"] }
      const octokit = createMockOctokit({
        repos: [{ owner: "acme", name: "app" }],
        issues: {
          "acme/app": [
            {
              number: 10,
              updated_at: minutesAgo(5), // only 5 minutes old
              labels: [{ name: "agent:planning" }],
            },
          ],
        },
        comments: {
          "acme/app#10": [
            {
              id: 1,
              body: "working on it...",
              created_at: minutesAgo(5),
              performed_via_github_app: { slug: "test-agent-bot" },
            },
          ],
        },
        issueLabels,
      })

      const reconciler = createReconciler(() => octokit, DEFAULT_CONFIG, silentLogger)
      const result = await reconciler.reconcile()

      expect(result.issuesRecovered).toBe(0)
      expect(issueLabels["acme/app#10"]).toContain("agent:planning")
      expect(octokit.rest.issues.createComment).not.toHaveBeenCalled()
    })

    it("stale agent:working issue transitions to agent:blocked", async () => {
      const issueLabels = { "acme/app#20": ["agent:working"] }
      const octokit = createMockOctokit({
        repos: [{ owner: "acme", name: "app" }],
        issues: {
          "acme/app": [
            {
              number: 20,
              updated_at: minutesAgo(60),
              labels: [{ name: "agent:working" }],
            },
          ],
        },
        comments: {},
        issueLabels,
      })

      const reconciler = createReconciler(() => octokit, DEFAULT_CONFIG, silentLogger)
      const result = await reconciler.reconcile()

      expect(result.issuesRecovered).toBe(1)
      expect(issueLabels["acme/app#20"]).not.toContain("agent:working")
      expect(issueLabels["acme/app#20"]).toContain("agent:blocked")
    })

    it("stale agent:approved issue is recovered", async () => {
      // agent:approved -> stop_requested -> agent:cancelled
      const issueLabels = { "acme/app#30": ["agent:approved"] }
      const octokit = createMockOctokit({
        repos: [{ owner: "acme", name: "app" }],
        issues: {
          "acme/app": [
            {
              number: 30,
              updated_at: minutesAgo(60),
              labels: [{ name: "agent:approved" }],
            },
          ],
        },
        comments: {},
        issueLabels,
      })

      const reconciler = createReconciler(() => octokit, DEFAULT_CONFIG, silentLogger)
      const result = await reconciler.reconcile()

      expect(result.issuesRecovered).toBe(1)
      expect(issueLabels["acme/app#30"]).not.toContain("agent:approved")
      // stop_requested from approved goes to cancelled
      expect(issueLabels["acme/app#30"]).toContain("agent:cancelled")
      expect(octokit.rest.issues.createComment).toHaveBeenCalled()
    })

    it("stale agent:security-review issue is recovered", async () => {
      // agent:security-review -> stop_requested -> agent:cancelled
      const issueLabels = { "acme/app#35": ["agent:security-review"] }
      const octokit = createMockOctokit({
        repos: [{ owner: "acme", name: "app" }],
        issues: {
          "acme/app": [
            {
              number: 35,
              updated_at: minutesAgo(60),
              labels: [{ name: "agent:security-review" }],
            },
          ],
        },
        comments: {},
        issueLabels,
      })

      const reconciler = createReconciler(() => octokit, DEFAULT_CONFIG, silentLogger)
      const result = await reconciler.reconcile()

      expect(result.issuesRecovered).toBe(1)
      expect(issueLabels["acme/app#35"]).not.toContain("agent:security-review")
      expect(issueLabels["acme/app#35"]).toContain("agent:cancelled")
    })
  })

  // -----------------------------------------------------------------------
  // Idempotency
  // -----------------------------------------------------------------------

  describe("idempotency", () => {
    it("agent:blocked issues are not re-blocked", async () => {
      // Issue has both agent:working and agent:blocked – the blocked check skips it
      const issueLabels = { "acme/app#40": ["agent:working", "agent:blocked"] }
      const octokit = createMockOctokit({
        repos: [{ owner: "acme", name: "app" }],
        issues: {
          "acme/app": [
            {
              number: 40,
              updated_at: minutesAgo(60),
              labels: [{ name: "agent:working" }, { name: "agent:blocked" }],
            },
          ],
        },
        comments: {},
        issueLabels,
      })

      const reconciler = createReconciler(() => octokit, DEFAULT_CONFIG, silentLogger)
      const result = await reconciler.reconcile()

      expect(result.issuesRecovered).toBe(0)
      expect(octokit.rest.issues.createComment).not.toHaveBeenCalled()
    })

    it("agent:done issues are not touched", async () => {
      const issueLabels = { "acme/app#50": ["agent:done"] }
      const octokit = createMockOctokit({
        repos: [{ owner: "acme", name: "app" }],
        issues: {
          "acme/app": [
            {
              number: 50,
              updated_at: minutesAgo(120),
              labels: [{ name: "agent:done" }],
            },
          ],
        },
        comments: {},
        issueLabels,
      })

      const reconciler = createReconciler(() => octokit, DEFAULT_CONFIG, silentLogger)
      const result = await reconciler.reconcile()

      // agent:done is not in STALE_CANDIDATE_LABELS, so it won't appear in searches
      expect(result.issuesRecovered).toBe(0)
      expect(octokit.rest.issues.createComment).not.toHaveBeenCalled()
    })

    it("repeated reconcile runs don't produce duplicate comments", async () => {
      // After first run: issue moves from agent:working -> agent:blocked.
      // On second run: the issue still has agent:working in the search results
      // from the mock, but now also has agent:blocked, so it's skipped.
      const issueLabels = { "acme/app#60": ["agent:working"] }
      const octokit = createMockOctokit({
        repos: [{ owner: "acme", name: "app" }],
        issues: {
          "acme/app": [
            {
              number: 60,
              updated_at: minutesAgo(60),
              labels: [{ name: "agent:working" }],
            },
          ],
        },
        comments: {},
        issueLabels,
      })

      const reconciler = createReconciler(() => octokit, DEFAULT_CONFIG, silentLogger)

      // First pass: should recover
      const result1 = await reconciler.reconcile()
      expect(result1.issuesRecovered).toBe(1)

      // After recovery, issueLabels should now contain agent:blocked
      expect(issueLabels["acme/app#60"]).toContain("agent:blocked")

      // Second pass: the issue still shows up in search results (mock returns
      // it for agent:working label query), but the label array now includes
      // agent:blocked, so it should be skipped.
      const result2 = await reconciler.reconcile()
      expect(result2.issuesRecovered).toBe(0)

      // createComment should have been called exactly once (from first pass)
      expect(octokit.rest.issues.createComment).toHaveBeenCalledTimes(1)
    })
  })

  // -----------------------------------------------------------------------
  // Staleness via bot comment age
  // -----------------------------------------------------------------------

  describe("staleness detection via bot comments", () => {
    it("uses bot comment time when available instead of updated_at", async () => {
      // Issue updated_at is old, but there's a recent bot comment
      const issueLabels = { "acme/app#70": ["agent:planning"] }
      const octokit = createMockOctokit({
        repos: [{ owner: "acme", name: "app" }],
        issues: {
          "acme/app": [
            {
              number: 70,
              updated_at: minutesAgo(120), // very stale updated_at
              labels: [{ name: "agent:planning" }],
            },
          ],
        },
        comments: {
          "acme/app#70": [
            {
              id: 1,
              body: "Still working...",
              created_at: minutesAgo(10), // recent bot comment
              performed_via_github_app: { slug: "test-agent-bot" },
            },
          ],
        },
        issueLabels,
      })

      const reconciler = createReconciler(() => octokit, DEFAULT_CONFIG, silentLogger)
      const result = await reconciler.reconcile()

      // Should NOT recover because bot commented recently
      expect(result.issuesRecovered).toBe(0)
    })

    it("falls back to updated_at when no bot comments exist", async () => {
      const issueLabels = { "acme/app#71": ["agent:planning"] }
      const octokit = createMockOctokit({
        repos: [{ owner: "acme", name: "app" }],
        issues: {
          "acme/app": [
            {
              number: 71,
              updated_at: minutesAgo(60),
              labels: [{ name: "agent:planning" }],
            },
          ],
        },
        comments: {
          // Only human comments, no bot comments
          "acme/app#71": [
            {
              id: 1,
              body: "Any updates?",
              created_at: minutesAgo(5),
              performed_via_github_app: null,
            },
          ],
        },
        issueLabels,
      })

      const reconciler = createReconciler(() => octokit, DEFAULT_CONFIG, silentLogger)
      const result = await reconciler.reconcile()

      // Should recover because no bot comment exists and updated_at is old
      expect(result.issuesRecovered).toBe(1)
    })
  })

  // -----------------------------------------------------------------------
  // Counts
  // -----------------------------------------------------------------------

  describe("result counts", () => {
    it("reconcile() returns correct counts", async () => {
      const issueLabels = {
        "acme/app#1": ["agent:planning"],
        "acme/app#2": ["agent:working"],
        "acme/app#3": ["agent:planning"],
      }
      const octokit = createMockOctokit({
        repos: [{ owner: "acme", name: "app" }],
        issues: {
          "acme/app": [
            {
              number: 1,
              updated_at: minutesAgo(60),
              labels: [{ name: "agent:planning" }],
            },
            {
              number: 2,
              updated_at: minutesAgo(60),
              labels: [{ name: "agent:working" }],
            },
            {
              number: 3,
              updated_at: minutesAgo(5), // fresh
              labels: [{ name: "agent:planning" }],
            },
          ],
        },
        comments: {
          "acme/app#3": [
            {
              id: 1,
              body: "progress",
              created_at: minutesAgo(5),
              performed_via_github_app: { slug: "test-agent-bot" },
            },
          ],
        },
        issueLabels,
      })

      const reconciler = createReconciler(() => octokit, DEFAULT_CONFIG, silentLogger)
      const result = await reconciler.reconcile()

      expect(result.reposScanned).toBe(1)
      expect(result.issuesChecked).toBe(3) // #1, #2 (working), #3 (planning)
      expect(result.issuesRecovered).toBe(2) // #1 and #2 stale, #3 fresh
      expect(result.errors).toHaveLength(0)
    })

    it("records errors but continues processing", async () => {
      const octokit = createMockOctokit({
        repos: [{ owner: "acme", name: "app" }],
        issues: {},
        issueLabels: {},
      })

      // Make listForRepo throw for the first label query
      let callCount = 0
      ;(octokit.rest.issues.listForRepo as any).mockImplementation(async ({ labels }: any) => {
        callCount++
        if (callCount === 1) {
          throw new Error("API rate limit exceeded")
        }
        return { data: [] }
      })

      const reconciler = createReconciler(() => octokit, DEFAULT_CONFIG, silentLogger)
      const result = await reconciler.reconcile()

      expect(result.errors.length).toBeGreaterThan(0)
      expect(result.errors[0]).toContain("API rate limit exceeded")
      // Should still have scanned the repo
      expect(result.reposScanned).toBe(1)
    })
  })

  // -----------------------------------------------------------------------
  // Start / stop
  // -----------------------------------------------------------------------

  describe("start/stop lifecycle", () => {
    it("start sets isRunning to true", () => {
      const octokit = createMockOctokit({ repos: [] })
      const reconciler = createReconciler(() => octokit, DEFAULT_CONFIG, silentLogger)

      expect(reconciler.isRunning()).toBe(false)
      reconciler.start()
      expect(reconciler.isRunning()).toBe(true)
      reconciler.stop()
    })

    it("stop sets isRunning to false", () => {
      const octokit = createMockOctokit({ repos: [] })
      const reconciler = createReconciler(() => octokit, DEFAULT_CONFIG, silentLogger)

      reconciler.start()
      expect(reconciler.isRunning()).toBe(true)
      reconciler.stop()
      expect(reconciler.isRunning()).toBe(false)
    })

    it("start is idempotent - calling twice does not create multiple intervals", () => {
      const octokit = createMockOctokit({ repos: [] })
      const reconciler = createReconciler(() => octokit, DEFAULT_CONFIG, silentLogger)

      reconciler.start()
      reconciler.start() // second call should be no-op

      expect(reconciler.isRunning()).toBe(true)
      reconciler.stop()
      expect(reconciler.isRunning()).toBe(false)
    })

    it("stop is idempotent - calling when not running does nothing", () => {
      const octokit = createMockOctokit({ repos: [] })
      const reconciler = createReconciler(() => octokit, DEFAULT_CONFIG, silentLogger)

      // Should not throw
      reconciler.stop()
      expect(reconciler.isRunning()).toBe(false)
    })

    it("periodic interval triggers reconcile", async () => {
      const issueLabels = { "acme/app#1": ["agent:working"] }
      const octokit = createMockOctokit({
        repos: [{ owner: "acme", name: "app" }],
        issues: {
          "acme/app": [
            {
              number: 1,
              updated_at: minutesAgo(60),
              labels: [{ name: "agent:working" }],
            },
          ],
        },
        comments: {},
        issueLabels,
      })

      const config = { ...DEFAULT_CONFIG, intervalMs: 1000 }
      const reconciler = createReconciler(() => octokit, config, silentLogger)

      reconciler.start()

      // Advance past one interval
      await vi.advanceTimersByTimeAsync(1100)

      // The interval should have fired and recovered the issue
      expect(octokit.rest.issues.createComment).toHaveBeenCalled()

      reconciler.stop()
    })
  })

  // -----------------------------------------------------------------------
  // Multiple repos
  // -----------------------------------------------------------------------

  describe("multi-repo scanning", () => {
    it("scans all repos across installations", async () => {
      const issueLabels = {
        "acme/app#1": ["agent:planning"],
        "acme/lib#5": ["agent:working"],
      }
      const octokit = createMockOctokit({
        repos: [
          { owner: "acme", name: "app" },
          { owner: "acme", name: "lib" },
        ],
        issues: {
          "acme/app": [
            {
              number: 1,
              updated_at: minutesAgo(60),
              labels: [{ name: "agent:planning" }],
            },
          ],
          "acme/lib": [
            {
              number: 5,
              updated_at: minutesAgo(60),
              labels: [{ name: "agent:working" }],
            },
          ],
        },
        comments: {},
        issueLabels,
      })

      const reconciler = createReconciler(() => octokit, DEFAULT_CONFIG, silentLogger)
      const result = await reconciler.reconcile()

      expect(result.reposScanned).toBe(2)
      expect(result.issuesRecovered).toBe(2)
    })
  })

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe("edge cases", () => {
    it("handles no installations gracefully", async () => {
      const octokit = createMockOctokit({ repos: [] })
      ;(octokit.rest.apps.listInstallations as any).mockResolvedValue({ data: [] })

      const reconciler = createReconciler(() => octokit, DEFAULT_CONFIG, silentLogger)
      const result = await reconciler.reconcile()

      expect(result.reposScanned).toBe(0)
      expect(result.issuesChecked).toBe(0)
      expect(result.issuesRecovered).toBe(0)
      expect(result.errors).toHaveLength(0)
    })

    it("handles listInstallations failure gracefully", async () => {
      const octokit = createMockOctokit({ repos: [] })
      ;(octokit.rest.apps.listInstallations as any).mockRejectedValue(
        new Error("Auth failed"),
      )

      const reconciler = createReconciler(() => octokit, DEFAULT_CONFIG, silentLogger)
      const result = await reconciler.reconcile()

      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toContain("Auth failed")
      expect(result.reposScanned).toBe(0)
    })

    it("posted comment contains timeout explanation", async () => {
      const issueLabels = { "acme/app#99": ["agent:working"] }
      const octokit = createMockOctokit({
        repos: [{ owner: "acme", name: "app" }],
        issues: {
          "acme/app": [
            {
              number: 99,
              updated_at: minutesAgo(60),
              labels: [{ name: "agent:working" }],
            },
          ],
        },
        comments: {},
        issueLabels,
      })

      const reconciler = createReconciler(() => octokit, DEFAULT_CONFIG, silentLogger)
      await reconciler.reconcile()

      const call = (octokit.rest.issues.createComment as any).mock.calls[0][0]
      expect(call.body).toContain("timed out")
      expect(call.body).toContain("agent:working")
      expect(call.body).toContain("Blocked")
    })
  })
})
