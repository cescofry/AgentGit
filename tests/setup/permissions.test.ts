import { describe, it, expect, vi } from "vitest"
import { checkPermissions } from "../../src/setup/permissions"

function createMockOctokit(options: {
  permissions?: Record<string, string>
  events?: string[]
  useInstallation?: boolean
  throwError?: boolean
}) {
  const data = {
    permissions: options.permissions ?? {},
    events: options.events ?? [],
  }

  return {
    rest: {
      apps: {
        getAuthenticated: vi.fn(async () => {
          if (options.throwError) {
            throw new Error("Auth failed")
          }
          return { data }
        }),
        getInstallation: vi.fn(async () => {
          if (options.throwError) {
            throw new Error("Installation not found")
          }
          return { data }
        }),
      },
    },
  }
}

describe("setup/permissions", () => {
  describe("checkPermissions", () => {
    it("all permissions present -> allPassed", async () => {
      const octokit = createMockOctokit({
        permissions: {
          issues: "write",
          pull_requests: "write",
          contents: "write",
          metadata: "read",
        },
        events: [
          "issues",
          "issue_comment",
          "pull_request",
          "pull_request_review",
          "label",
        ],
      })

      const result = await checkPermissions(octokit, "owner", "repo")

      expect(result.allPassed).toBe(true)
      expect(result.permissions.every((p) => p.status === "ok")).toBe(true)
      expect(result.webhookEvents.every((e) => e.status === "ok")).toBe(true)
    })

    it("missing permission detected", async () => {
      const octokit = createMockOctokit({
        permissions: {
          issues: "write",
          // pull_requests missing
          contents: "write",
          metadata: "read",
        },
        events: [
          "issues",
          "issue_comment",
          "pull_request",
          "pull_request_review",
          "label",
        ],
      })

      const result = await checkPermissions(octokit, "owner", "repo")

      expect(result.allPassed).toBe(false)
      const missing = result.permissions.find((p) => p.name === "pull_requests")
      expect(missing).toBeDefined()
      expect(missing!.status).toBe("missing")
    })

    it("missing webhook event detected", async () => {
      const octokit = createMockOctokit({
        permissions: {
          issues: "write",
          pull_requests: "write",
          contents: "write",
          metadata: "read",
        },
        events: [
          "issues",
          "issue_comment",
          "pull_request",
          // pull_request_review missing
          "label",
        ],
      })

      const result = await checkPermissions(octokit, "owner", "repo")

      expect(result.allPassed).toBe(false)
      const missing = result.webhookEvents.find(
        (e) => e.name === "pull_request_review",
      )
      expect(missing).toBeDefined()
      expect(missing!.status).toBe("missing")
    })

    it("write access satisfies read requirement", async () => {
      const octokit = createMockOctokit({
        permissions: {
          issues: "write",
          pull_requests: "write",
          contents: "write",
          metadata: "write", // write satisfies read requirement
        },
        events: [
          "issues",
          "issue_comment",
          "pull_request",
          "pull_request_review",
          "label",
        ],
      })

      const result = await checkPermissions(octokit, "owner", "repo")

      expect(result.allPassed).toBe(true)
      const metadata = result.permissions.find((p) => p.name === "metadata")
      expect(metadata!.status).toBe("ok")
    })

    it("read access does not satisfy write requirement", async () => {
      const octokit = createMockOctokit({
        permissions: {
          issues: "read", // read does not satisfy write
          pull_requests: "write",
          contents: "write",
          metadata: "read",
        },
        events: [
          "issues",
          "issue_comment",
          "pull_request",
          "pull_request_review",
          "label",
        ],
      })

      const result = await checkPermissions(octokit, "owner", "repo")

      expect(result.allPassed).toBe(false)
      const issues = result.permissions.find((p) => p.name === "issues")
      expect(issues!.status).toBe("missing")
    })

    it("uses getInstallation when installationId is provided", async () => {
      const octokit = createMockOctokit({
        permissions: {
          issues: "write",
          pull_requests: "write",
          contents: "write",
          metadata: "read",
        },
        events: [
          "issues",
          "issue_comment",
          "pull_request",
          "pull_request_review",
          "label",
        ],
        useInstallation: true,
      })

      await checkPermissions(octokit, "owner", "repo", 12345)

      expect(octokit.rest.apps.getInstallation).toHaveBeenCalledWith({
        installation_id: 12345,
      })
      expect(octokit.rest.apps.getAuthenticated).not.toHaveBeenCalled()
    })

    it("marks all as error when API call fails", async () => {
      const octokit = createMockOctokit({ throwError: true })

      const result = await checkPermissions(octokit, "owner", "repo")

      expect(result.allPassed).toBe(false)
      expect(result.permissions.every((p) => p.status === "error")).toBe(true)
      expect(result.webhookEvents.every((e) => e.status === "error")).toBe(true)
    })

    it("detects multiple missing permissions and events simultaneously", async () => {
      const octokit = createMockOctokit({
        permissions: {
          metadata: "read",
          // issues, pull_requests, contents all missing
        },
        events: [
          "issues",
          // others missing
        ],
      })

      const result = await checkPermissions(octokit, "owner", "repo")

      expect(result.allPassed).toBe(false)
      const missingPerms = result.permissions.filter((p) => p.status === "missing")
      expect(missingPerms.length).toBe(3) // issues, pull_requests, contents
      const missingEvents = result.webhookEvents.filter((e) => e.status === "missing")
      expect(missingEvents.length).toBe(4) // issue_comment, pull_request, pull_request_review, label
    })
  })
})
