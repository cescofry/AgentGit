import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createPoller, PollerConfig, PollerOctokit } from "../../src/state/reconciler"
import { createLogger } from "../../src/utils/logger"
import { createStateManager } from "../../src/state/manager"
import { createSkillRegistry } from "../../src/skills/registry"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockDeps() {
  const logger = createLogger("error")
  return {
    stateManager: createStateManager(),
    skillRegistry: createSkillRegistry(),
    signingSecret: "test-secret-key",
    appSlug: "test-agent-bot",
    logger,
  }
}

const DEFAULT_CONFIG: PollerConfig = {
  intervalMs: 10 * 60 * 1000,
  staleThresholdMs: 30 * 60 * 1000,
  appSlug: "test-agent-bot",
  signingSecret: "test-secret-key",
  workerId: "test-worker-1",
  deps: createMockDeps(),
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString()
}

/**
 * Build a mock PollerOctokit.
 */
function createMockOctokit(opts: {
  repos?: Array<{ owner: string; name: string }>
  issues?: Record<
    string,
    Array<{
      number: number
      title?: string
      body?: string
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
      user?: { login: string; type: string }
      performed_via_github_app?: { slug: string } | null
    }>
  >
  /** Per-issue label arrays -- mutated by addLabels / removeLabel */
  issueLabels?: Record<string, string[]>
}): PollerOctokit {
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
          if (labels) {
            // Filter to issues that have the requested label
            return {
              data: all.filter((issue) =>
                issue.labels.some((l) => l.name === labels),
              ),
            }
          }
          return { data: all }
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
        getContent: vi.fn(async () => {
          throw Object.assign(new Error("Not found"), { status: 404 })
        }),
      },
    },
  } as unknown as PollerOctokit
}

const silentLogger = createLogger("error")

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Poller", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // -----------------------------------------------------------------------
  // Stale issue recovery (the old reconciler behavior)
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
        comments: {},
        issueLabels,
      })

      const poller = createPoller(() => octokit, DEFAULT_CONFIG, silentLogger)
      const result = await poller.poll()

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

      const poller = createPoller(() => octokit, DEFAULT_CONFIG, silentLogger)
      const result = await poller.poll()

      expect(result.issuesRecovered).toBe(0)
      expect(issueLabels["acme/app#10"]).toContain("agent:planning")
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

      const poller = createPoller(() => octokit, DEFAULT_CONFIG, silentLogger)
      const result = await poller.poll()

      expect(result.issuesRecovered).toBe(1)
      expect(issueLabels["acme/app#20"]).not.toContain("agent:working")
      expect(issueLabels["acme/app#20"]).toContain("agent:blocked")
    })

    it("stale agent:approved issue is recovered", async () => {
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

      const poller = createPoller(() => octokit, DEFAULT_CONFIG, silentLogger)
      const result = await poller.poll()

      expect(result.issuesRecovered).toBe(1)
      expect(issueLabels["acme/app#30"]).not.toContain("agent:approved")
      // stop_requested from approved goes to cancelled
      expect(issueLabels["acme/app#30"]).toContain("agent:cancelled")
      expect(octokit.rest.issues.createComment).toHaveBeenCalled()
    })

    it("stale agent:security-review issue is recovered", async () => {
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

      const poller = createPoller(() => octokit, DEFAULT_CONFIG, silentLogger)
      const result = await poller.poll()

      expect(result.issuesRecovered).toBe(1)
      expect(issueLabels["acme/app#35"]).not.toContain("agent:security-review")
      expect(issueLabels["acme/app#35"]).toContain("agent:cancelled")
    })
  })

  // -----------------------------------------------------------------------
  // Start / stop
  // -----------------------------------------------------------------------

  describe("start/stop", () => {
    it("starts and stops interval", () => {
      const octokit = createMockOctokit({ repos: [] })
      const poller = createPoller(() => octokit, DEFAULT_CONFIG, silentLogger)

      expect(poller.isRunning()).toBe(false)
      poller.start()
      expect(poller.isRunning()).toBe(true)
      poller.stop()
      expect(poller.isRunning()).toBe(false)
    })

    it("start is idempotent", () => {
      const octokit = createMockOctokit({ repos: [] })
      const poller = createPoller(() => octokit, DEFAULT_CONFIG, silentLogger)

      poller.start()
      poller.start() // should not throw or create duplicate intervals
      expect(poller.isRunning()).toBe(true)
      poller.stop()
    })

    it("stop is idempotent", () => {
      const octokit = createMockOctokit({ repos: [] })
      const poller = createPoller(() => octokit, DEFAULT_CONFIG, silentLogger)

      poller.stop() // should not throw when not started
      expect(poller.isRunning()).toBe(false)
    })
  })

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  describe("error handling", () => {
    it("handles installation list failure gracefully", async () => {
      const octokit = createMockOctokit({ repos: [] })
      ;(octokit.rest.apps.listInstallations as any).mockRejectedValueOnce(
        new Error("API error"),
      )

      const poller = createPoller(() => octokit, DEFAULT_CONFIG, silentLogger)
      const result = await poller.poll()

      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toContain("API error")
      expect(result.reposScanned).toBe(0)
    })

    it("handles repo list failure gracefully and continues", async () => {
      const octokit = createMockOctokit({ repos: [] })
      ;(octokit.rest.apps.listReposAccessibleToInstallation as any).mockRejectedValueOnce(
        new Error("Repo list error"),
      )

      const poller = createPoller(() => octokit, DEFAULT_CONFIG, silentLogger)
      const result = await poller.poll()

      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toContain("Repo list error")
    })
  })

  // -----------------------------------------------------------------------
  // Empty state
  // -----------------------------------------------------------------------

  describe("empty state", () => {
    it("handles no repos gracefully", async () => {
      const octokit = createMockOctokit({ repos: [] })

      const poller = createPoller(() => octokit, DEFAULT_CONFIG, silentLogger)
      const result = await poller.poll()

      expect(result.reposScanned).toBe(0)
      expect(result.errors).toHaveLength(0)
    })

    it("handles repos with no issues", async () => {
      const octokit = createMockOctokit({
        repos: [{ owner: "acme", name: "app" }],
        issues: { "acme/app": [] },
      })

      const poller = createPoller(() => octokit, DEFAULT_CONFIG, silentLogger)
      const result = await poller.poll()

      expect(result.reposScanned).toBe(1)
      expect(result.issuesRecovered).toBe(0)
      expect(result.commandsProcessed).toBe(0)
    })
  })
})
