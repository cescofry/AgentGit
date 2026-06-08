import { describe, it, expect, vi } from "vitest"
import {
  permissionAtLeast,
  getPermissionLevel,
  isAuthorized,
  type GitHubPermission,
  type AuthorizationContext,
} from "../../src/github/auth"

// ── Helpers ──

/** Create a mock octokit that returns the given permission string. */
function mockOctokit(permission: string) {
  return {
    rest: {
      repos: {
        getCollaboratorPermissionLevel: vi.fn().mockResolvedValue({
          data: { permission },
        }),
      },
    },
  }
}

/** Build a default AuthorizationContext, overridable per-test. */
function makeContext(
  overrides: Partial<AuthorizationContext> = {},
): AuthorizationContext {
  return {
    senderLogin: "alice",
    repoOwner: "myorg",
    repoName: "myrepo",
    issueNumber: 42,
    requiredPermissions: ["admin", "maintain"],
    allowedUsers: [],
    securityAdmins: [],
    minDelegatePermission: "write",
    ...overrides,
  }
}

// ── Tests ──

describe("permissionAtLeast", () => {
  const levels: GitHubPermission[] = [
    "admin",
    "maintain",
    "write",
    "triage",
    "read",
  ]

  it("admin is at least every level", () => {
    for (const level of levels) {
      expect(permissionAtLeast("admin", level)).toBe(true)
    }
  })

  it("maintain is at least maintain, write, triage, read", () => {
    expect(permissionAtLeast("maintain", "admin")).toBe(false)
    expect(permissionAtLeast("maintain", "maintain")).toBe(true)
    expect(permissionAtLeast("maintain", "write")).toBe(true)
    expect(permissionAtLeast("maintain", "triage")).toBe(true)
    expect(permissionAtLeast("maintain", "read")).toBe(true)
  })

  it("write is at least write, triage, read", () => {
    expect(permissionAtLeast("write", "admin")).toBe(false)
    expect(permissionAtLeast("write", "maintain")).toBe(false)
    expect(permissionAtLeast("write", "write")).toBe(true)
    expect(permissionAtLeast("write", "triage")).toBe(true)
    expect(permissionAtLeast("write", "read")).toBe(true)
  })

  it("triage is at least triage and read only", () => {
    expect(permissionAtLeast("triage", "admin")).toBe(false)
    expect(permissionAtLeast("triage", "maintain")).toBe(false)
    expect(permissionAtLeast("triage", "write")).toBe(false)
    expect(permissionAtLeast("triage", "triage")).toBe(true)
    expect(permissionAtLeast("triage", "read")).toBe(true)
  })

  it("read is at least read only", () => {
    expect(permissionAtLeast("read", "admin")).toBe(false)
    expect(permissionAtLeast("read", "maintain")).toBe(false)
    expect(permissionAtLeast("read", "write")).toBe(false)
    expect(permissionAtLeast("read", "triage")).toBe(false)
    expect(permissionAtLeast("read", "read")).toBe(true)
  })
})

describe("getPermissionLevel", () => {
  it("returns admin for admin permission", async () => {
    const octokit = mockOctokit("admin")
    const result = await getPermissionLevel(octokit, "org", "repo", "user")
    expect(result).toBe("admin")
  })

  it("returns maintain for maintain permission", async () => {
    const octokit = mockOctokit("maintain")
    const result = await getPermissionLevel(octokit, "org", "repo", "user")
    expect(result).toBe("maintain")
  })

  it("returns write for write permission", async () => {
    const octokit = mockOctokit("write")
    const result = await getPermissionLevel(octokit, "org", "repo", "user")
    expect(result).toBe("write")
  })

  it("returns triage for triage permission", async () => {
    const octokit = mockOctokit("triage")
    const result = await getPermissionLevel(octokit, "org", "repo", "user")
    expect(result).toBe("triage")
  })

  it("returns read for read permission", async () => {
    const octokit = mockOctokit("read")
    const result = await getPermissionLevel(octokit, "org", "repo", "user")
    expect(result).toBe("read")
  })

  it("maps 'none' to read", async () => {
    const octokit = mockOctokit("none")
    const result = await getPermissionLevel(octokit, "org", "repo", "user")
    expect(result).toBe("read")
  })

  it("maps unknown permission to read", async () => {
    const octokit = mockOctokit("superuser")
    const result = await getPermissionLevel(octokit, "org", "repo", "user")
    expect(result).toBe("read")
  })

  it("calls the API with correct parameters", async () => {
    const octokit = mockOctokit("write")
    await getPermissionLevel(octokit, "myorg", "myrepo", "alice")
    expect(
      octokit.rest.repos.getCollaboratorPermissionLevel,
    ).toHaveBeenCalledWith({
      owner: "myorg",
      repo: "myrepo",
      username: "alice",
    })
  })
})

describe("isAuthorized", () => {
  // ── Public commands ──

  describe("public commands", () => {
    it("authorizes /agent status for anyone", async () => {
      const octokit = mockOctokit("read")
      const ctx = makeContext({ senderLogin: "random-user" })
      const result = await isAuthorized(octokit, "status", ctx)
      expect(result.authorized).toBe(true)
      expect(result.via).toBe("public")
    })

    it("authorizes /agent delegates for anyone", async () => {
      const octokit = mockOctokit("read")
      const ctx = makeContext()
      const result = await isAuthorized(octokit, "delegates", ctx)
      expect(result.authorized).toBe(true)
      expect(result.via).toBe("public")
    })

    it("authorizes /agent security-status for anyone", async () => {
      const octokit = mockOctokit("read")
      const ctx = makeContext()
      const result = await isAuthorized(octokit, "security-status", ctx)
      expect(result.authorized).toBe(true)
      expect(result.via).toBe("public")
    })

    it("does not call GitHub API for public commands", async () => {
      const octokit = mockOctokit("read")
      const ctx = makeContext()
      await isAuthorized(octokit, "status", ctx)
      expect(
        octokit.rest.repos.getCollaboratorPermissionLevel,
      ).not.toHaveBeenCalled()
    })
  })

  // ── Allowlist ──

  describe("allowed users", () => {
    it("authorizes allowed user regardless of permission", async () => {
      const octokit = mockOctokit("read")
      const ctx = makeContext({
        senderLogin: "alice",
        allowedUsers: ["alice"],
      })
      const result = await isAuthorized(octokit, "plan", ctx)
      expect(result.authorized).toBe(true)
      expect(result.via).toBe("allowlist")
    })

    it("allowlist check is case-insensitive", async () => {
      const octokit = mockOctokit("read")
      const ctx = makeContext({
        senderLogin: "Alice",
        allowedUsers: ["alice"],
      })
      const result = await isAuthorized(octokit, "plan", ctx)
      expect(result.authorized).toBe(true)
      expect(result.via).toBe("allowlist")
    })

    it("does not call GitHub API when user is on allowlist", async () => {
      const octokit = mockOctokit("read")
      const ctx = makeContext({
        senderLogin: "alice",
        allowedUsers: ["alice"],
      })
      await isAuthorized(octokit, "plan", ctx)
      expect(
        octokit.rest.repos.getCollaboratorPermissionLevel,
      ).not.toHaveBeenCalled()
    })
  })

  // ── Admin permission ──

  describe("admin commands", () => {
    it("admin user can run delegate", async () => {
      const octokit = mockOctokit("admin")
      const ctx = makeContext({ senderLogin: "admin-user" })
      const result = await isAuthorized(octokit, "delegate", ctx)
      expect(result.authorized).toBe(true)
      expect(result.via).toBe("permission")
    })

    it("maintain user can run delegate (default requiredPermissions)", async () => {
      const octokit = mockOctokit("maintain")
      const ctx = makeContext({ senderLogin: "maintainer" })
      const result = await isAuthorized(octokit, "delegate", ctx)
      expect(result.authorized).toBe(true)
      expect(result.via).toBe("permission")
    })

    it("write user cannot run delegate", async () => {
      const octokit = mockOctokit("write")
      const ctx = makeContext({ senderLogin: "writer" })
      const result = await isAuthorized(octokit, "delegate", ctx)
      expect(result.authorized).toBe(false)
      expect(result.via).toBe("rejected")
      expect(result.reason).toContain("cannot be delegated")
    })

    it("write user cannot run undelegate", async () => {
      const octokit = mockOctokit("write")
      const ctx = makeContext({ senderLogin: "writer" })
      const result = await isAuthorized(octokit, "undelegate", ctx)
      expect(result.authorized).toBe(false)
      expect(result.via).toBe("rejected")
    })

    it("write user cannot run stop", async () => {
      const octokit = mockOctokit("write")
      const ctx = makeContext({ senderLogin: "writer" })
      const result = await isAuthorized(octokit, "stop", ctx)
      expect(result.authorized).toBe(false)
      expect(result.via).toBe("rejected")
    })
  })

  // ── Permission-based access ──

  describe("permission-based access", () => {
    it("admin user can run plan", async () => {
      const octokit = mockOctokit("admin")
      const ctx = makeContext()
      const result = await isAuthorized(octokit, "plan", ctx)
      expect(result.authorized).toBe(true)
      expect(result.via).toBe("permission")
    })

    it("maintain user can run approve", async () => {
      const octokit = mockOctokit("maintain")
      const ctx = makeContext()
      const result = await isAuthorized(octokit, "approve", ctx)
      expect(result.authorized).toBe(true)
      expect(result.via).toBe("permission")
    })

    it("write user cannot run plan with default required permissions", async () => {
      const octokit = mockOctokit("write")
      const ctx = makeContext()
      const result = await isAuthorized(octokit, "plan", ctx)
      expect(result.authorized).toBe(false)
      expect(result.via).toBe("rejected")
    })

    it("write user can run plan when requiredPermissions includes write", async () => {
      const octokit = mockOctokit("write")
      const ctx = makeContext({
        requiredPermissions: ["admin", "maintain", "write"],
      })
      const result = await isAuthorized(octokit, "plan", ctx)
      expect(result.authorized).toBe(true)
      expect(result.via).toBe("permission")
    })

    it("read user is rejected for plan", async () => {
      const octokit = mockOctokit("read")
      const ctx = makeContext()
      const result = await isAuthorized(octokit, "plan", ctx)
      expect(result.authorized).toBe(false)
      expect(result.via).toBe("rejected")
    })
  })

  // ── Security commands ──

  describe("security commands", () => {
    it("security admin can run unlock-security", async () => {
      const octokit = mockOctokit("write")
      const ctx = makeContext({
        senderLogin: "sec-admin",
        securityAdmins: ["sec-admin"],
      })
      const result = await isAuthorized(octokit, "unlock-security", ctx)
      expect(result.authorized).toBe(true)
      expect(result.via).toBe("permission")
    })

    it("security admin can run close-unsafe", async () => {
      const octokit = mockOctokit("write")
      const ctx = makeContext({
        senderLogin: "sec-admin",
        securityAdmins: ["sec-admin"],
      })
      const result = await isAuthorized(octokit, "close-unsafe", ctx)
      expect(result.authorized).toBe(true)
      expect(result.via).toBe("permission")
    })

    it("non-security user without required permission is rejected for security commands", async () => {
      const octokit = mockOctokit("write")
      const ctx = makeContext({ senderLogin: "normal-user" })
      const result = await isAuthorized(octokit, "unlock-security", ctx)
      expect(result.authorized).toBe(false)
      expect(result.via).toBe("rejected")
      expect(result.reason).toContain("security admin")
    })

    it("admin user can run security commands via permission", async () => {
      const octokit = mockOctokit("admin")
      const ctx = makeContext({ senderLogin: "admin-user" })
      const result = await isAuthorized(octokit, "unlock-security", ctx)
      expect(result.authorized).toBe(true)
      expect(result.via).toBe("permission")
    })

    it("security admin check is case-insensitive", async () => {
      const octokit = mockOctokit("read")
      const ctx = makeContext({
        senderLogin: "SEC-Admin",
        securityAdmins: ["sec-admin"],
      })
      const result = await isAuthorized(octokit, "close-unsafe", ctx)
      expect(result.authorized).toBe(true)
      expect(result.via).toBe("permission")
    })
  })

  // ── Delegation (Phase 4 hook) ──

  describe("delegation", () => {
    it("delegated user is authorized for delegatable command", async () => {
      const octokit = mockOctokit("write")
      const ctx = makeContext({ senderLogin: "bob" })
      const getDelegations = vi.fn().mockResolvedValue([
        { username: "bob", command: "plan" },
      ])
      const result = await isAuthorized(octokit, "plan", ctx, getDelegations)
      expect(result.authorized).toBe(true)
      expect(result.via).toBe("delegation")
    })

    it("wildcard delegation authorizes any delegatable command", async () => {
      const octokit = mockOctokit("write")
      const ctx = makeContext({ senderLogin: "bob" })
      const getDelegations = vi.fn().mockResolvedValue([
        { username: "bob", command: "*" },
      ])
      const result = await isAuthorized(
        octokit,
        "approve",
        ctx,
        getDelegations,
      )
      expect(result.authorized).toBe(true)
      expect(result.via).toBe("delegation")
    })

    it("delegation does not apply to admin-only commands", async () => {
      const octokit = mockOctokit("write")
      const ctx = makeContext({ senderLogin: "bob" })
      const getDelegations = vi.fn().mockResolvedValue([
        { username: "bob", command: "delegate" },
      ])
      const result = await isAuthorized(
        octokit,
        "delegate",
        ctx,
        getDelegations,
      )
      expect(result.authorized).toBe(false)
      expect(result.via).toBe("rejected")
      // getDelegations should not even be called for admin-only commands
      expect(getDelegations).not.toHaveBeenCalled()
    })

    it("user without matching delegation is rejected", async () => {
      const octokit = mockOctokit("write")
      const ctx = makeContext({ senderLogin: "charlie" })
      const getDelegations = vi.fn().mockResolvedValue([
        { username: "bob", command: "plan" },
      ])
      const result = await isAuthorized(octokit, "plan", ctx, getDelegations)
      expect(result.authorized).toBe(false)
      expect(result.via).toBe("rejected")
    })

    it("delegation check uses correct issue number", async () => {
      const octokit = mockOctokit("write")
      const ctx = makeContext({ senderLogin: "bob", issueNumber: 99 })
      const getDelegations = vi.fn().mockResolvedValue([
        { username: "bob", command: "plan" },
      ])
      await isAuthorized(octokit, "plan", ctx, getDelegations)
      expect(getDelegations).toHaveBeenCalledWith(99)
    })

    it("skips delegation check when getDelegations is not provided", async () => {
      const octokit = mockOctokit("write")
      const ctx = makeContext({ senderLogin: "bob" })
      const result = await isAuthorized(octokit, "plan", ctx)
      expect(result.authorized).toBe(false)
      expect(result.via).toBe("rejected")
    })
  })

  // ── Rejection reasons ──

  describe("rejection reasons", () => {
    it("includes the user's actual permission in rejection", async () => {
      const octokit = mockOctokit("read")
      const ctx = makeContext({ senderLogin: "reader" })
      const result = await isAuthorized(octokit, "plan", ctx)
      expect(result.reason).toContain("read")
      expect(result.reason).toContain("reader")
    })

    it("includes required permissions in rejection for regular commands", async () => {
      const octokit = mockOctokit("write")
      const ctx = makeContext({ senderLogin: "writer" })
      const result = await isAuthorized(octokit, "plan", ctx)
      expect(result.reason).toContain("admin")
      expect(result.reason).toContain("maintain")
    })
  })
})
