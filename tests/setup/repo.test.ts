import { describe, it, expect, vi, beforeEach } from "vitest"
import { setupRepo } from "../../src/setup/repo"
import * as fs from "fs"

vi.mock("fs")

const mockFs = vi.mocked(fs)

function createMockOctokit(options?: {
  authFail?: boolean
  permissionsOk?: boolean
  existingLabels?: string[]
}) {
  const opts = {
    authFail: false,
    permissionsOk: true,
    existingLabels: [] as string[],
    ...options,
  }

  const existingSet = new Set(opts.existingLabels)

  return {
    rest: {
      apps: {
        getAuthenticated: vi.fn(async () => {
          if (opts.authFail) throw new Error("Auth failed")
          return {
            data: {
              permissions: opts.permissionsOk
                ? {
                    issues: "write",
                    pull_requests: "write",
                    contents: "write",
                    metadata: "read",
                  }
                : {},
              events: opts.permissionsOk
                ? [
                    "issues",
                    "issue_comment",
                    "pull_request",
                    "pull_request_review",
                    "label",
                  ]
                : [],
            },
          }
        }),
      },
      issues: {
        getLabel: vi.fn(async ({ name }: { name: string }) => {
          if (existingSet.has(name)) {
            return { data: { name } }
          }
          throw Object.assign(new Error("Not found"), { status: 404 })
        }),
        createLabel: vi.fn(async ({ name }: { name: string }) => {
          return { data: { name } }
        }),
      },
    },
  }
}

describe("setup/repo", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("setup creates labels and config directory", async () => {
    const octokit = createMockOctokit()
    mockFs.existsSync.mockReturnValue(false)
    mockFs.mkdirSync.mockReturnValue(undefined as any)
    mockFs.writeFileSync.mockReturnValue(undefined)

    const result = await setupRepo({
      octokit,
      owner: "test-owner",
      repo: "test-repo",
    })

    expect(result.success).toBe(true)
    expect(result.steps).toHaveLength(5)

    // All steps should be ok
    for (const step of result.steps) {
      expect(step.status).toBe("ok")
    }

    // Verify labels were created
    const labelStep = result.steps.find((s) =>
      s.step.includes("labels"),
    )
    expect(labelStep).toBeDefined()
    expect(labelStep!.status).toBe("ok")

    // Verify directory was created
    expect(mockFs.mkdirSync).toHaveBeenCalled()

    // Verify config was written
    expect(mockFs.writeFileSync).toHaveBeenCalled()
  })

  it("dry run doesn't modify anything", async () => {
    const octokit = createMockOctokit()

    const result = await setupRepo({
      octokit,
      owner: "test-owner",
      repo: "test-repo",
      dryRun: true,
    })

    expect(result.success).toBe(true)

    // First two steps should be ok (credential check, permissions)
    expect(result.steps[0].status).toBe("ok")
    expect(result.steps[1].status).toBe("ok")

    // Remaining steps should be skipped
    expect(result.steps[2].status).toBe("skipped")
    expect(result.steps[3].status).toBe("skipped")
    expect(result.steps[4].status).toBe("skipped")

    // No label creation calls
    expect(octokit.rest.issues.getLabel).not.toHaveBeenCalled()
    expect(octokit.rest.issues.createLabel).not.toHaveBeenCalled()

    // No filesystem modifications
    expect(mockFs.mkdirSync).not.toHaveBeenCalled()
    expect(mockFs.writeFileSync).not.toHaveBeenCalled()
  })

  it("fails when GitHub App credentials are invalid", async () => {
    const octokit = createMockOctokit({ authFail: true })

    const result = await setupRepo({
      octokit,
      owner: "test-owner",
      repo: "test-repo",
    })

    expect(result.success).toBe(false)
    expect(result.steps[0].status).toBe("error")
    expect(result.steps[0].details).toContain("Auth failed")
  })

  it("fails when permissions are missing", async () => {
    const octokit = createMockOctokit({ permissionsOk: false })

    const result = await setupRepo({
      octokit,
      owner: "test-owner",
      repo: "test-repo",
    })

    expect(result.success).toBe(false)
    const permStep = result.steps.find((s) => s.step.includes("permissions"))
    expect(permStep).toBeDefined()
    expect(permStep!.status).toBe("error")
  })

  it("reports existing .agentGit directory as ok", async () => {
    const octokit = createMockOctokit()
    mockFs.existsSync.mockReturnValue(true)
    mockFs.writeFileSync.mockReturnValue(undefined)

    const result = await setupRepo({
      octokit,
      owner: "test-owner",
      repo: "test-repo",
    })

    expect(result.success).toBe(true)

    const dirStep = result.steps.find((s) => s.step.includes("directory"))
    expect(dirStep).toBeDefined()
    expect(dirStep!.status).toBe("ok")
    expect(dirStep!.details).toContain("Already exists")

    // Should not try to create it
    expect(mockFs.mkdirSync).not.toHaveBeenCalled()
  })

  it("applies config overrides", async () => {
    const octokit = createMockOctokit()
    mockFs.existsSync.mockReturnValue(false)
    mockFs.mkdirSync.mockReturnValue(undefined as any)
    mockFs.writeFileSync.mockReturnValue(undefined)

    await setupRepo({
      octokit,
      owner: "test-owner",
      repo: "test-repo",
      configOverrides: { enabled: false },
    })

    // Verify the config written contains the override
    const writeCall = mockFs.writeFileSync.mock.calls[0]
    const writtenContent = writeCall[1] as string
    const parsed = JSON.parse(writtenContent)
    expect(parsed.enabled).toBe(false)
  })
})
