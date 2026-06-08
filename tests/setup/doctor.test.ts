import { describe, it, expect, vi, beforeEach } from "vitest"
import { runDoctor } from "../../src/setup/doctor"
import * as fs from "fs"
import { execSync } from "child_process"

vi.mock("fs")
vi.mock("child_process")

const mockFs = vi.mocked(fs)
const mockExecSync = vi.mocked(execSync)

function createMockOctokit(options?: {
  authFail?: boolean
  permissionsOk?: boolean
  labels?: string[]
  apiFail?: boolean
}) {
  const opts = {
    authFail: false,
    permissionsOk: true,
    labels: ["agent:ready", "agent:working"],
    apiFail: false,
    ...options,
  }

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
        listLabelsForRepo: vi.fn(async () => ({
          data: opts.labels.map((name) => ({ name })),
        })),
      },
      meta: {
        get: vi.fn(async () => {
          if (opts.apiFail) throw new Error("Network error")
          return { data: {} }
        }),
      },
    },
  }
}

describe("setup/doctor", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("all checks pass -> exit code 0", async () => {
    // Mock Node version - already running so process.version is fine
    // Mock git version
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "git --version") return "git version 2.40.0" as any
      if (cmd === "docker --version") return "Docker version 24.0.0" as any
      if (cmd === "opencode --version") return "opencode 1.0.0" as any
      return "" as any
    })

    // Mock env vars
    const envBackup = { ...process.env }
    process.env.GITHUB_APP_ID = "123"
    process.env.GITHUB_WEBHOOK_SECRET = "secret"
    process.env.AGENTGIT_SIGNING_SECRET = "sign-secret"
    process.env.GITHUB_APP_PRIVATE_KEY = "key"

    // Mock fs for repo checks
    mockFs.existsSync.mockReturnValue(true)

    const octokit = createMockOctokit()

    const result = await runDoctor({
      octokit,
      owner: "test-owner",
      repo: "test-repo",
      localPath: "/test/path",
    })

    expect(result.exitCode).toBe(0)
    expect(result.totalFailed).toBe(0)
    expect(result.totalPassed).toBeGreaterThan(0)

    // Restore env
    process.env = envBackup
  })

  it("warning only -> exit code 2", async () => {
    // git ok, docker missing, opencode missing
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "git --version") return "git version 2.40.0" as any
      if (cmd === "docker --version") throw new Error("not found")
      if (cmd === "opencode --version") throw new Error("not found")
      return "" as any
    })

    // Mock env vars
    const envBackup = { ...process.env }
    process.env.GITHUB_APP_ID = "123"
    process.env.GITHUB_WEBHOOK_SECRET = "secret"
    process.env.AGENTGIT_SIGNING_SECRET = "sign-secret"
    process.env.GITHUB_APP_PRIVATE_KEY = "key"

    // No localPath, no octokit -> only server environment + connectivity sections
    const result = await runDoctor({})

    expect(result.exitCode).toBe(2)
    expect(result.totalFailed).toBe(0)
    expect(result.totalWarnings).toBeGreaterThan(0)

    process.env = envBackup
  })

  it("failure -> exit code 1", async () => {
    // git missing
    mockExecSync.mockImplementation(() => {
      throw new Error("not found")
    })

    // Missing env vars
    const envBackup = { ...process.env }
    delete process.env.GITHUB_APP_ID
    delete process.env.GITHUB_WEBHOOK_SECRET
    delete process.env.AGENTGIT_SIGNING_SECRET
    delete process.env.GITHUB_APP_PRIVATE_KEY
    delete process.env.GITHUB_APP_PRIVATE_KEY_PATH

    const result = await runDoctor({})

    expect(result.exitCode).toBe(1)
    expect(result.totalFailed).toBeGreaterThan(0)

    process.env = envBackup
  })

  it("includes Repository section when localPath is provided", async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "git --version") return "git version 2.40.0" as any
      throw new Error("not found")
    })

    const envBackup = { ...process.env }
    process.env.GITHUB_APP_ID = "123"
    process.env.GITHUB_WEBHOOK_SECRET = "secret"
    process.env.AGENTGIT_SIGNING_SECRET = "sign-secret"
    process.env.GITHUB_APP_PRIVATE_KEY = "key"

    mockFs.existsSync.mockReturnValue(true)

    const result = await runDoctor({ localPath: "/some/path" })

    const repoSection = result.sections.find((s) => s.name === "Repository")
    expect(repoSection).toBeDefined()
    expect(repoSection!.checks.length).toBeGreaterThan(0)

    process.env = envBackup
  })

  it("includes GitHub App section when octokit is provided", async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "git --version") return "git version 2.40.0" as any
      throw new Error("not found")
    })

    const envBackup = { ...process.env }
    process.env.GITHUB_APP_ID = "123"
    process.env.GITHUB_WEBHOOK_SECRET = "secret"
    process.env.AGENTGIT_SIGNING_SECRET = "sign-secret"
    process.env.GITHUB_APP_PRIVATE_KEY = "key"

    const octokit = createMockOctokit()

    const result = await runDoctor({
      octokit,
      owner: "owner",
      repo: "repo",
    })

    const appSection = result.sections.find((s) => s.name === "GitHub App")
    expect(appSection).toBeDefined()

    process.env = envBackup
  })

  it("reports missing .agentGit directory as error", async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "git --version") return "git version 2.40.0" as any
      throw new Error("not found")
    })

    const envBackup = { ...process.env }
    process.env.GITHUB_APP_ID = "123"
    process.env.GITHUB_WEBHOOK_SECRET = "secret"
    process.env.AGENTGIT_SIGNING_SECRET = "sign-secret"
    process.env.GITHUB_APP_PRIVATE_KEY = "key"

    mockFs.existsSync.mockReturnValue(false)

    const result = await runDoctor({ localPath: "/test/path" })

    const repoSection = result.sections.find((s) => s.name === "Repository")
    expect(repoSection).toBeDefined()
    const dirCheck = repoSection!.checks.find((c) => c.name === ".agentGit/ directory")
    expect(dirCheck).toBeDefined()
    expect(dirCheck!.status).toBe("error")

    process.env = envBackup
  })

  it("always includes Connectivity section", async () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === "git --version") return "git version 2.40.0" as any
      throw new Error("not found")
    })

    const envBackup = { ...process.env }
    process.env.GITHUB_APP_ID = "123"
    process.env.GITHUB_WEBHOOK_SECRET = "secret"
    process.env.AGENTGIT_SIGNING_SECRET = "sign-secret"
    process.env.GITHUB_APP_PRIVATE_KEY = "key"

    const result = await runDoctor({})

    const connSection = result.sections.find((s) => s.name === "Connectivity")
    expect(connSection).toBeDefined()

    process.env = envBackup
  })
})
