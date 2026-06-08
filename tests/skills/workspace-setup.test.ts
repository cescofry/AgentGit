import { describe, it, expect, vi, beforeEach } from "vitest"
import { WorkspaceSetupSkill } from "../../src/skills/builtin/workspace-setup"
import { ExecutionContext, SkillInput } from "../../src/skills/interface"
import { createLogger } from "../../src/utils/logger"
import { DEFAULT_CONFIG } from "../../src/config/defaults"

// Mock child_process
vi.mock("child_process", () => ({
  execSync: vi.fn(),
}))

// Mock workspace manager
vi.mock("../../src/workspace/manager", () => ({
  createWorkspaceManager: vi.fn(() => ({
    create: vi.fn().mockResolvedValue({
      path: "/tmp/agentgit/my-repo/issue-42",
      issueNumber: 42,
      repoName: "my-repo",
      branch: "agent/issue-42",
      createdAt: new Date(),
    }),
    cleanup: vi.fn(),
    list: vi.fn(),
  })),
}))

import { execSync } from "child_process"

describe("WorkspaceSetupSkill", () => {
  let skill: WorkspaceSetupSkill
  let context: ExecutionContext

  beforeEach(() => {
    vi.clearAllMocks()

    skill = new WorkspaceSetupSkill()

    context = {
      issueContext: {
        issueNumber: 42,
        issueTitle: "Fix the bug",
        issueBody: "There is a bug",
        comments: [],
        labels: ["bug"],
        repoUrl: "https://github.com/owner/my-repo",
        repoOwner: "owner",
        repoName: "my-repo",
      },
      repoConfig: { ...DEFAULT_CONFIG },
      logger: createLogger("error"),
      harness: {
        name: "mock",
        proposePlan: vi.fn(),
        revisePlan: vi.fn(),
        executePlan: vi.fn(),
      },
      workspacePath: "/tmp/agentgit",
      signingSecret: "test-secret",
    }
  })

  it('has correct name and description', () => {
    expect(skill.name).toBe("workspace-setup")
    expect(skill.description).toContain("Clone")
  })

  it("creates workspace and clones repo", async () => {
    const mockedExecSync = vi.mocked(execSync)
    mockedExecSync.mockReturnValue(Buffer.from(""))

    const input: SkillInput = {
      repo: "https://github.com/owner/my-repo.git",
      branch_prefix: "agent/",
    }

    const result = await skill.execute(input, context)

    expect(result.success).toBe(true)
    expect(result.data.workspace_path).toBe("/tmp/agentgit/my-repo/issue-42")
    expect(result.data.branch).toBe("agent/issue-42")
    expect(result.data.repo_name).toBe("my-repo")
    expect(result.data.issue_number).toBe(42)

    // Verify git clone was called
    expect(mockedExecSync).toHaveBeenCalledWith(
      "git clone --depth 1 https://github.com/owner/my-repo.git .",
      expect.objectContaining({
        cwd: "/tmp/agentgit/my-repo/issue-42",
      }),
    )

    // Verify git checkout was called
    expect(mockedExecSync).toHaveBeenCalledWith(
      "git checkout -b agent/issue-42",
      expect.objectContaining({
        cwd: "/tmp/agentgit/my-repo/issue-42",
      }),
    )
  })

  it("returns workspace_path and branch in result", async () => {
    const mockedExecSync = vi.mocked(execSync)
    mockedExecSync.mockReturnValue(Buffer.from(""))

    const input: SkillInput = {
      repo: "https://github.com/owner/my-repo.git",
    }

    const result = await skill.execute(input, context)

    expect(result.success).toBe(true)
    expect(result.data).toHaveProperty("workspace_path")
    expect(result.data).toHaveProperty("branch")
    expect(typeof result.data.workspace_path).toBe("string")
    expect(typeof result.data.branch).toBe("string")
  })

  it("returns error when repo input is missing", async () => {
    const result = await skill.execute({}, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain("Missing required input: repo")
  })

  it("handles clone failure gracefully", async () => {
    const mockedExecSync = vi.mocked(execSync)
    mockedExecSync.mockImplementation(() => {
      throw new Error("fatal: repository not found")
    })

    const input: SkillInput = {
      repo: "https://github.com/owner/bad-repo.git",
    }

    const result = await skill.execute(input, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain("Failed to clone repository")
  })

  it("handles branch checkout failure", async () => {
    const mockedExecSync = vi.mocked(execSync)
    // First call (clone) succeeds, second call (checkout) fails
    mockedExecSync
      .mockReturnValueOnce(Buffer.from("")) // clone
      .mockImplementationOnce(() => {
        throw new Error("branch already exists")
      })

    const input: SkillInput = {
      repo: "https://github.com/owner/my-repo.git",
    }

    const result = await skill.execute(input, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain("Failed to create branch")
  })
})
