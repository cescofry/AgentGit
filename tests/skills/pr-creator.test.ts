import { describe, it, expect, vi, beforeEach } from "vitest"
import { PrCreatorSkill } from "../../src/skills/builtin/pr-creator"
import { ExecutionContext, SkillInput } from "../../src/skills/interface"
import { createLogger } from "../../src/utils/logger"
import { DEFAULT_CONFIG } from "../../src/config/defaults"
import { hasMetadata, parseMetadataComment } from "../../src/utils/metadata"
import { verifySignature } from "../../src/security/signing"

// Mock child_process
vi.mock("child_process", () => ({
  execSync: vi.fn(),
}))

import { execSync } from "child_process"

describe("PrCreatorSkill", () => {
  let skill: PrCreatorSkill
  let context: ExecutionContext

  beforeEach(() => {
    vi.clearAllMocks()

    skill = new PrCreatorSkill()

    context = {
      issueContext: {
        issueNumber: 42,
        issueTitle: "Fix the login bug",
        issueBody: "Login is broken",
        comments: [],
        labels: ["bug"],
        repoUrl: "https://github.com/owner/repo",
        repoOwner: "owner",
        repoName: "repo",
      },
      repoConfig: { ...DEFAULT_CONFIG },
      logger: createLogger("error"),
      harness: {
        name: "mock",
        proposePlan: vi.fn(),
        revisePlan: vi.fn(),
        executePlan: vi.fn(),
      },
      workspacePath: "/tmp/workspace",
      signingSecret: "test-signing-secret",
    }
  })

  it("has correct name and description", () => {
    expect(skill.name).toBe("pr-creator")
    expect(skill.description).toContain("PR")
  })

  it("stages, commits, and pushes changes", async () => {
    const mockedExecSync = vi.mocked(execSync)
    mockedExecSync.mockReturnValue(Buffer.from(""))

    const input: SkillInput = {
      workspace: "/tmp/workspace",
      branch: "agent/issue-42",
      diff_summary: "src/auth.ts | 10 +++",
      test_results: "All tests passed",
      warnings: [],
    }

    const result = await skill.execute(input, context)

    expect(result.success).toBe(true)

    // Verify git add was called
    expect(mockedExecSync).toHaveBeenCalledWith(
      "git add .",
      expect.objectContaining({ cwd: "/tmp/workspace" }),
    )

    // Verify git commit was called with issue reference
    const commitCall = mockedExecSync.mock.calls.find(
      (call) => typeof call[0] === "string" && call[0].startsWith("git commit"),
    )
    expect(commitCall).toBeDefined()
    expect(commitCall![0]).toContain("#42")

    // Verify git push was called
    expect(mockedExecSync).toHaveBeenCalledWith(
      "git push origin agent/issue-42",
      expect.objectContaining({ cwd: "/tmp/workspace" }),
    )
  })

  it("PR body contains signed metadata", async () => {
    const mockedExecSync = vi.mocked(execSync)
    mockedExecSync.mockReturnValue(Buffer.from(""))

    const input: SkillInput = {
      workspace: "/tmp/workspace",
      branch: "agent/issue-42",
      diff_summary: "Changed files",
      warnings: [],
    }

    const result = await skill.execute(input, context)

    expect(result.success).toBe(true)
    expect(result.data.body).toBeDefined()

    // Body should contain metadata
    expect(hasMetadata(result.data.body)).toBe(true)

    // Parse and verify the metadata
    const parsed = parseMetadataComment(result.data.body)
    expect(parsed).not.toBeNull()
    expect(parsed!.metadata).toHaveProperty("issue_number", 42)
    expect(parsed!.metadata).toHaveProperty("type", "pr")
    expect(parsed!.metadata).toHaveProperty("signature")

    // Verify signature is valid
    expect(verifySignature(parsed!.metadata as Record<string, any>, "test-signing-secret")).toBe(true)
  })

  it("PR title references issue number", async () => {
    const mockedExecSync = vi.mocked(execSync)
    mockedExecSync.mockReturnValue(Buffer.from(""))

    const input: SkillInput = {
      workspace: "/tmp/workspace",
      branch: "agent/issue-42",
      diff_summary: "",
      warnings: [],
    }

    const result = await skill.execute(input, context)

    expect(result.success).toBe(true)
    expect(result.data.title).toContain("#42")
    expect(result.data.title).toContain("Fix the login bug")
  })

  it("returns PR creation data for orchestrator", async () => {
    const mockedExecSync = vi.mocked(execSync)
    mockedExecSync.mockReturnValue(Buffer.from(""))

    const input: SkillInput = {
      workspace: "/tmp/workspace",
      branch: "agent/issue-42",
      diff_summary: "3 files changed",
      warnings: ["Docs may need updating"],
    }

    const result = await skill.execute(input, context)

    expect(result.success).toBe(true)
    expect(result.data.head).toBe("agent/issue-42")
    expect(result.data.base).toBe("main")
    expect(result.data.owner).toBe("owner")
    expect(result.data.repo).toBe("repo")
    expect(result.data.issue_number).toBe(42)
  })

  it("returns error when workspace is missing", async () => {
    const result = await skill.execute({ branch: "test" }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain("Missing required input: workspace")
  })

  it("returns error when branch is missing", async () => {
    const result = await skill.execute({ workspace: "/tmp" }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain("Missing required input: branch")
  })

  it("handles git add failure", async () => {
    const mockedExecSync = vi.mocked(execSync)
    mockedExecSync.mockImplementation(() => {
      throw new Error("git add failed")
    })

    const input: SkillInput = {
      workspace: "/tmp/workspace",
      branch: "agent/issue-42",
    }

    const result = await skill.execute(input, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain("Failed to stage changes")
  })

  it("handles git push failure", async () => {
    const mockedExecSync = vi.mocked(execSync)
    // add and commit succeed, push fails
    mockedExecSync
      .mockReturnValueOnce(Buffer.from("")) // git add
      .mockReturnValueOnce(Buffer.from("")) // git commit
      .mockImplementationOnce(() => {
        throw new Error("permission denied")
      })

    const input: SkillInput = {
      workspace: "/tmp/workspace",
      branch: "agent/issue-42",
    }

    const result = await skill.execute(input, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain("Failed to push branch")
  })

  it("includes warnings in PR body", async () => {
    const mockedExecSync = vi.mocked(execSync)
    mockedExecSync.mockReturnValue(Buffer.from(""))

    const input: SkillInput = {
      workspace: "/tmp/workspace",
      branch: "agent/issue-42",
      diff_summary: "",
      warnings: ["Consider updating docs", "Check test coverage"],
    }

    const result = await skill.execute(input, context)

    expect(result.success).toBe(true)
    const parsed = parseMetadataComment(result.data.body)
    expect(parsed!.body).toContain("Consider updating docs")
    expect(parsed!.body).toContain("Check test coverage")
  })
})
