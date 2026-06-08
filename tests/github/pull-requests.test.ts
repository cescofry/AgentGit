import { describe, it, expect, vi } from "vitest"
import { createPullRequest, verifyPrProvenance, PrCreateParams } from "../../src/github/pull-requests"
import { createMetadataComment } from "../../src/utils/metadata"

describe("createPullRequest", () => {
  it("calls octokit to create PR and link to issue", async () => {
    const mockOctokit = {
      rest: {
        pulls: {
          create: vi.fn().mockResolvedValue({
            data: {
              number: 99,
              html_url: "https://github.com/owner/repo/pull/99",
            },
          }),
        },
        issues: {
          createComment: vi.fn().mockResolvedValue({}),
        },
      },
    }

    const params: PrCreateParams = {
      owner: "owner",
      repo: "repo",
      title: "[AgentGit] Fix #42: Login bug",
      body: "PR body with metadata",
      head: "agent/issue-42",
      base: "main",
      issueNumber: 42,
    }

    const result = await createPullRequest(mockOctokit, params)

    expect(result.prNumber).toBe(99)
    expect(result.prUrl).toBe("https://github.com/owner/repo/pull/99")

    // Verify pulls.create was called with correct params
    expect(mockOctokit.rest.pulls.create).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      title: "[AgentGit] Fix #42: Login bug",
      body: "PR body with metadata",
      head: "agent/issue-42",
      base: "main",
    })

    // Verify issue comment was created
    expect(mockOctokit.rest.issues.createComment).toHaveBeenCalledWith({
      owner: "owner",
      repo: "repo",
      issue_number: 42,
      body: expect.stringContaining("#99"),
    })
  })

  it("propagates octokit errors", async () => {
    const mockOctokit = {
      rest: {
        pulls: {
          create: vi.fn().mockRejectedValue(new Error("Validation Failed")),
        },
        issues: {
          createComment: vi.fn(),
        },
      },
    }

    const params: PrCreateParams = {
      owner: "owner",
      repo: "repo",
      title: "Test PR",
      body: "body",
      head: "branch",
      base: "main",
      issueNumber: 1,
    }

    await expect(createPullRequest(mockOctokit, params)).rejects.toThrow("Validation Failed")
  })
})

describe("verifyPrProvenance", () => {
  const appSlug = "agentgit"
  const branchPrefix = "agent/"
  const signingSecret = "test-secret-key"

  function makePr(overrides: Partial<{
    login: string
    type: string
    body: string
    ref: string
  }> = {}) {
    const metadata = {
      type: "pr",
      issue_number: 42,
      repo: "owner/repo",
    }
    const body = overrides.body ?? createMetadataComment(metadata, "PR body", signingSecret)

    return {
      user: {
        login: overrides.login ?? "agentgit[bot]",
        type: overrides.type ?? "Bot",
      },
      body,
      head: {
        ref: overrides.ref ?? "agent/issue-42",
      },
    }
  }

  it("validates a legitimate bot PR", () => {
    const pr = makePr()

    const result = verifyPrProvenance(pr, appSlug, branchPrefix, signingSecret)

    expect(result.valid).toBe(true)
    expect(result.reason).toBeUndefined()
  })

  it("rejects PR from wrong user", () => {
    const pr = makePr({ login: "impostor", type: "User" })

    const result = verifyPrProvenance(pr, appSlug, branchPrefix, signingSecret)

    expect(result.valid).toBe(false)
    expect(result.reason).toContain("impostor")
  })

  it("rejects PR with wrong branch prefix", () => {
    const pr = makePr({ ref: "feature/my-branch" })

    const result = verifyPrProvenance(pr, appSlug, branchPrefix, signingSecret)

    expect(result.valid).toBe(false)
    expect(result.reason).toContain("prefix")
  })

  it("rejects PR with no metadata in body", () => {
    const pr = makePr({ body: "Just a regular PR body" })

    const result = verifyPrProvenance(pr, appSlug, branchPrefix, signingSecret)

    expect(result.valid).toBe(false)
    expect(result.reason).toContain("metadata")
  })

  it("rejects PR with invalid signature", () => {
    // Create metadata signed with a different secret
    const metadata = {
      type: "pr",
      issue_number: 42,
    }
    const body = createMetadataComment(metadata, "body", "wrong-secret")
    const pr = makePr({ body })

    const result = verifyPrProvenance(pr, appSlug, branchPrefix, signingSecret)

    expect(result.valid).toBe(false)
    expect(result.reason).toContain("signature")
  })

  it("handles branch prefix without trailing slash", () => {
    const pr = makePr({ ref: "agent/issue-42" })

    // branchPrefix without trailing slash
    const result = verifyPrProvenance(pr, appSlug, "agent", signingSecret)

    expect(result.valid).toBe(true)
  })
})
