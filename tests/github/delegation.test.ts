import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  parseDelegateArgs,
  createDelegationComment,
  createRevocationComment,
  getActiveDelegations,
  isDelegatedFor,
  formatDelegationsList,
  DEFAULT_DELEGATION_SCOPES,
  VALID_DELEGATION_SCOPES,
  DelegationMetadata,
} from "../../src/github/delegation"
import { parseMetadataComment, createMetadataComment } from "../../src/utils/metadata"
import { verifySignature } from "../../src/security/signing"

const APP_SLUG = "agentgit"
const SIGNING_SECRET = "test-delegation-secret"

// Helper: create a bot comment object
function makeBotComment(body: string) {
  return {
    user: { login: `${APP_SLUG}[bot]`, type: "Bot" },
    body,
  }
}

// Helper: create a human comment object
function makeUserComment(body: string, login = "some-user") {
  return {
    user: { login, type: "User" },
    body,
  }
}

describe("delegation", () => {
  // ── parseDelegateArgs ──

  describe("parseDelegateArgs", () => {
    it("parses @user with specific scopes", () => {
      const result = parseDelegateArgs("@alice plan revise")
      expect(result).toEqual({ username: "alice", scopes: ["plan", "revise"] })
    })

    it("parses @user with all valid scopes", () => {
      const result = parseDelegateArgs("@bob plan revise approve run retry")
      expect(result).toEqual({
        username: "bob",
        scopes: ["plan", "revise", "approve", "run", "retry"],
      })
    })

    it("uses default scopes when no scopes specified", () => {
      const result = parseDelegateArgs("@charlie")
      expect(result).toEqual({
        username: "charlie",
        scopes: [...DEFAULT_DELEGATION_SCOPES],
      })
    })

    it("uses default scopes when all scope tokens are invalid", () => {
      const result = parseDelegateArgs("@dave invalid garbage")
      expect(result).toEqual({
        username: "dave",
        scopes: [...DEFAULT_DELEGATION_SCOPES],
      })
    })

    it("filters out invalid scopes and keeps valid ones", () => {
      const result = parseDelegateArgs("@eve plan invalid run")
      expect(result).toEqual({
        username: "eve",
        scopes: ["plan", "run"],
      })
    })

    it("returns null for empty string", () => {
      expect(parseDelegateArgs("")).toBeNull()
    })

    it("returns null for whitespace-only string", () => {
      expect(parseDelegateArgs("   ")).toBeNull()
    })

    it("returns null when no @username is present", () => {
      expect(parseDelegateArgs("alice plan")).toBeNull()
    })

    it("returns null for just a bare word without @", () => {
      expect(parseDelegateArgs("plan")).toBeNull()
    })

    it("handles usernames with hyphens and underscores", () => {
      const result = parseDelegateArgs("@my-user_name run")
      expect(result).toEqual({ username: "my-user_name", scopes: ["run"] })
    })

    it("handles leading/trailing whitespace", () => {
      const result = parseDelegateArgs("  @alice plan  ")
      expect(result).toEqual({ username: "alice", scopes: ["plan"] })
    })

    it("normalizes scopes to lowercase", () => {
      const result = parseDelegateArgs("@alice PLAN Run")
      expect(result).toEqual({ username: "alice", scopes: ["plan", "run"] })
    })

    it("handles single scope", () => {
      const result = parseDelegateArgs("@alice retry")
      expect(result).toEqual({ username: "alice", scopes: ["retry"] })
    })
  })

  // ── createDelegationComment ──

  describe("createDelegationComment", () => {
    let dateSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      dateSpy = vi.spyOn(Date.prototype, "toISOString").mockReturnValue(
        "2025-06-07T12:00:00.000Z",
      )
    })

    afterEach(() => {
      dateSpy.mockRestore()
    })

    it("produces a comment with valid signed metadata", () => {
      const body = createDelegationComment(42, "admin-user", "alice", ["plan", "run"], SIGNING_SECRET)
      const parsed = parseMetadataComment<DelegationMetadata>(body)

      expect(parsed).not.toBeNull()
      expect(parsed!.metadata.kind).toBe("delegation")
      expect(parsed!.metadata.issue).toBe(42)
      expect(parsed!.metadata.delegated_by).toBe("admin-user")
      expect(parsed!.metadata.delegated_to).toBe("alice")
      expect(parsed!.metadata.scopes).toEqual(["plan", "run"])
      expect(parsed!.metadata.created_at).toBe("2025-06-07T12:00:00.000Z")
      expect(parsed!.metadata.expires_at).toBeNull()
      expect(parsed!.metadata.revoked_at).toBeNull()
      expect(parsed!.metadata.signature).toBeDefined()
    })

    it("produces a comment with a valid signature", () => {
      const body = createDelegationComment(1, "admin", "bob", ["plan"], SIGNING_SECRET)
      const parsed = parseMetadataComment<DelegationMetadata>(body)

      expect(verifySignature(parsed!.metadata, SIGNING_SECRET)).toBe(true)
    })

    it("signature fails with a different secret", () => {
      const body = createDelegationComment(1, "admin", "bob", ["plan"], SIGNING_SECRET)
      const parsed = parseMetadataComment<DelegationMetadata>(body)

      expect(verifySignature(parsed!.metadata, "wrong-secret")).toBe(false)
    })

    it("includes human-readable text mentioning the delegated user", () => {
      const body = createDelegationComment(10, "admin", "alice", ["plan", "run"], SIGNING_SECRET)
      const parsed = parseMetadataComment(body)

      expect(parsed!.body).toContain("@admin")
      expect(parsed!.body).toContain("@alice")
      expect(parsed!.body).toContain("`plan`")
      expect(parsed!.body).toContain("`run`")
    })
  })

  // ── createRevocationComment ──

  describe("createRevocationComment", () => {
    let dateSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      dateSpy = vi.spyOn(Date.prototype, "toISOString").mockReturnValue(
        "2025-06-07T14:00:00.000Z",
      )
    })

    afterEach(() => {
      dateSpy.mockRestore()
    })

    it("produces a comment with revocation metadata", () => {
      const body = createRevocationComment(42, "admin-user", "alice", SIGNING_SECRET)
      const parsed = parseMetadataComment<any>(body)

      expect(parsed).not.toBeNull()
      expect(parsed!.metadata.kind).toBe("delegation-revocation")
      expect(parsed!.metadata.issue).toBe(42)
      expect(parsed!.metadata.delegated_to).toBe("alice")
      expect(parsed!.metadata.revoked_by).toBe("admin-user")
      expect(parsed!.metadata.revoked_at).toBe("2025-06-07T14:00:00.000Z")
    })

    it("produces a valid signature", () => {
      const body = createRevocationComment(42, "admin", "alice", SIGNING_SECRET)
      const parsed = parseMetadataComment<any>(body)

      expect(verifySignature(parsed!.metadata, SIGNING_SECRET)).toBe(true)
    })

    it("includes human-readable text about the revocation", () => {
      const body = createRevocationComment(42, "admin", "alice", SIGNING_SECRET)
      const parsed = parseMetadataComment(body)

      expect(parsed!.body).toContain("@admin")
      expect(parsed!.body).toContain("@alice")
      expect(parsed!.body).toContain("revoked")
    })
  })

  // ── getActiveDelegations ──

  describe("getActiveDelegations", () => {
    it("returns delegation from a valid bot comment", () => {
      const body = createDelegationComment(1, "admin", "alice", ["plan", "run"], SIGNING_SECRET)
      const comments = [makeBotComment(body)]

      const result = getActiveDelegations(comments, APP_SLUG, SIGNING_SECRET, 1)
      expect(result).toHaveLength(1)
      expect(result[0].delegated_to).toBe("alice")
      expect(result[0].scopes).toEqual(["plan", "run"])
    })

    it("ignores non-bot comments", () => {
      const body = createDelegationComment(1, "admin", "alice", ["plan"], SIGNING_SECRET)
      const comments = [makeUserComment(body)]

      const result = getActiveDelegations(comments, APP_SLUG, SIGNING_SECRET, 1)
      expect(result).toHaveLength(0)
    })

    it("ignores comments with invalid signatures", () => {
      const body = createDelegationComment(1, "admin", "alice", ["plan"], "different-secret")
      const comments = [makeBotComment(body)]

      const result = getActiveDelegations(comments, APP_SLUG, SIGNING_SECRET, 1)
      expect(result).toHaveLength(0)
    })

    it("ignores comments without metadata", () => {
      const comments = [makeBotComment("Just a regular comment, no metadata here.")]

      const result = getActiveDelegations(comments, APP_SLUG, SIGNING_SECRET, 1)
      expect(result).toHaveLength(0)
    })

    it("ignores delegations for a different issue number", () => {
      const body = createDelegationComment(99, "admin", "alice", ["plan"], SIGNING_SECRET)
      const comments = [makeBotComment(body)]

      const result = getActiveDelegations(comments, APP_SLUG, SIGNING_SECRET, 1)
      expect(result).toHaveLength(0)
    })

    it("filters out revoked delegations", () => {
      const delegationBody = createDelegationComment(1, "admin", "alice", ["plan"], SIGNING_SECRET)
      const revocationBody = createRevocationComment(1, "admin", "alice", SIGNING_SECRET)

      const comments = [
        makeBotComment(delegationBody),
        makeBotComment(revocationBody),
      ]

      const result = getActiveDelegations(comments, APP_SLUG, SIGNING_SECRET, 1)
      expect(result).toHaveLength(0)
    })

    it("only revokes if revocation comment is AFTER the delegation", () => {
      const revocationBody = createRevocationComment(1, "admin", "alice", SIGNING_SECRET)
      const delegationBody = createDelegationComment(1, "admin", "alice", ["plan"], SIGNING_SECRET)

      // Revocation comes BEFORE the delegation
      const comments = [
        makeBotComment(revocationBody),
        makeBotComment(delegationBody),
      ]

      const result = getActiveDelegations(comments, APP_SLUG, SIGNING_SECRET, 1)
      expect(result).toHaveLength(1)
      expect(result[0].delegated_to).toBe("alice")
    })

    it("revocation only affects the targeted user", () => {
      const delegationAlice = createDelegationComment(1, "admin", "alice", ["plan"], SIGNING_SECRET)
      const delegationBob = createDelegationComment(1, "admin", "bob", ["run"], SIGNING_SECRET)
      const revokeAlice = createRevocationComment(1, "admin", "alice", SIGNING_SECRET)

      const comments = [
        makeBotComment(delegationAlice),
        makeBotComment(delegationBob),
        makeBotComment(revokeAlice),
      ]

      const result = getActiveDelegations(comments, APP_SLUG, SIGNING_SECRET, 1)
      expect(result).toHaveLength(1)
      expect(result[0].delegated_to).toBe("bob")
    })

    it("filters out expired delegations", () => {
      // Manually create a delegation with expires_at in the past
      const pastDate = new Date(Date.now() - 86400000).toISOString() // yesterday
      const metadata = {
        kind: "delegation" as const,
        issue: 1,
        delegated_by: "admin",
        delegated_to: "alice",
        scopes: ["plan"],
        created_at: new Date(Date.now() - 172800000).toISOString(),
        expires_at: pastDate,
        revoked_at: null,
      }
      const body = createMetadataComment(metadata, "Expired delegation", SIGNING_SECRET)
      const comments = [makeBotComment(body)]

      const result = getActiveDelegations(comments, APP_SLUG, SIGNING_SECRET, 1)
      expect(result).toHaveLength(0)
    })

    it("keeps non-expired delegations with future expires_at", () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString() // tomorrow
      const metadata = {
        kind: "delegation" as const,
        issue: 1,
        delegated_by: "admin",
        delegated_to: "alice",
        scopes: ["plan"],
        created_at: new Date().toISOString(),
        expires_at: futureDate,
        revoked_at: null,
      }
      const body = createMetadataComment(metadata, "Valid delegation", SIGNING_SECRET)
      const comments = [makeBotComment(body)]

      const result = getActiveDelegations(comments, APP_SLUG, SIGNING_SECRET, 1)
      expect(result).toHaveLength(1)
    })

    it("keeps delegations with null expires_at (no expiry)", () => {
      const body = createDelegationComment(1, "admin", "alice", ["plan"], SIGNING_SECRET)
      const comments = [makeBotComment(body)]

      const result = getActiveDelegations(comments, APP_SLUG, SIGNING_SECRET, 1)
      expect(result).toHaveLength(1)
      expect(result[0].expires_at).toBeNull()
    })

    it("handles multiple delegations for different users", () => {
      const d1 = createDelegationComment(1, "admin", "alice", ["plan"], SIGNING_SECRET)
      const d2 = createDelegationComment(1, "admin", "bob", ["run", "retry"], SIGNING_SECRET)
      const d3 = createDelegationComment(1, "admin", "charlie", ["approve"], SIGNING_SECRET)

      const comments = [makeBotComment(d1), makeBotComment(d2), makeBotComment(d3)]

      const result = getActiveDelegations(comments, APP_SLUG, SIGNING_SECRET, 1)
      expect(result).toHaveLength(3)
    })

    it("ignores comments with non-delegation metadata kinds", () => {
      const metadata = {
        kind: "plan-output",
        issue: 1,
        content: "some plan",
      }
      const body = createMetadataComment(metadata, "Plan output", SIGNING_SECRET)
      const comments = [makeBotComment(body)]

      const result = getActiveDelegations(comments, APP_SLUG, SIGNING_SECRET, 1)
      expect(result).toHaveLength(0)
    })

    it("handles re-delegation after revocation", () => {
      const d1 = createDelegationComment(1, "admin", "alice", ["plan"], SIGNING_SECRET)
      const revoke = createRevocationComment(1, "admin", "alice", SIGNING_SECRET)
      const d2 = createDelegationComment(1, "admin", "alice", ["plan", "run"], SIGNING_SECRET)

      const comments = [
        makeBotComment(d1),
        makeBotComment(revoke),
        makeBotComment(d2),
      ]

      const result = getActiveDelegations(comments, APP_SLUG, SIGNING_SECRET, 1)
      // d1 is revoked (revoke is after it), d2 is active (no revocation after it)
      expect(result).toHaveLength(1)
      expect(result[0].delegated_to).toBe("alice")
      expect(result[0].scopes).toEqual(["plan", "run"])
    })

    it("revocation is case-insensitive for username matching", () => {
      const delegation = createDelegationComment(1, "admin", "Alice", ["plan"], SIGNING_SECRET)
      // Create a revocation with lowercase "alice"
      const revocation = createRevocationComment(1, "admin", "alice", SIGNING_SECRET)

      const comments = [
        makeBotComment(delegation),
        makeBotComment(revocation),
      ]

      const result = getActiveDelegations(comments, APP_SLUG, SIGNING_SECRET, 1)
      expect(result).toHaveLength(0)
    })
  })

  // ── isDelegatedFor ──

  describe("isDelegatedFor", () => {
    const sampleDelegations: DelegationMetadata[] = [
      {
        kind: "delegation",
        issue: 1,
        delegated_by: "admin",
        delegated_to: "alice",
        scopes: ["plan", "revise"],
        created_at: "2025-06-07T12:00:00.000Z",
        expires_at: null,
        revoked_at: null,
      },
      {
        kind: "delegation",
        issue: 1,
        delegated_by: "admin",
        delegated_to: "bob",
        scopes: ["run", "retry"],
        created_at: "2025-06-07T12:00:00.000Z",
        expires_at: null,
        revoked_at: null,
      },
    ]

    it("returns true when user has the requested scope", () => {
      expect(isDelegatedFor(sampleDelegations, "alice", "plan")).toBe(true)
      expect(isDelegatedFor(sampleDelegations, "alice", "revise")).toBe(true)
      expect(isDelegatedFor(sampleDelegations, "bob", "run")).toBe(true)
      expect(isDelegatedFor(sampleDelegations, "bob", "retry")).toBe(true)
    })

    it("returns false when user does not have the requested scope", () => {
      expect(isDelegatedFor(sampleDelegations, "alice", "run")).toBe(false)
      expect(isDelegatedFor(sampleDelegations, "bob", "plan")).toBe(false)
    })

    it("returns false when user is not delegated at all", () => {
      expect(isDelegatedFor(sampleDelegations, "charlie", "plan")).toBe(false)
    })

    it("is case-insensitive for username", () => {
      expect(isDelegatedFor(sampleDelegations, "Alice", "plan")).toBe(true)
      expect(isDelegatedFor(sampleDelegations, "ALICE", "plan")).toBe(true)
    })

    it("is case-insensitive for command", () => {
      expect(isDelegatedFor(sampleDelegations, "alice", "PLAN")).toBe(true)
      expect(isDelegatedFor(sampleDelegations, "alice", "Plan")).toBe(true)
    })

    it("returns false for empty delegations array", () => {
      expect(isDelegatedFor([], "alice", "plan")).toBe(false)
    })
  })

  // ── formatDelegationsList ──

  describe("formatDelegationsList", () => {
    it("returns a message when there are no delegations", () => {
      const result = formatDelegationsList([])
      expect(result).toBe("No active delegations on this issue.")
    })

    it("produces a markdown table for a single delegation", () => {
      const delegations: DelegationMetadata[] = [
        {
          kind: "delegation",
          issue: 1,
          delegated_by: "admin",
          delegated_to: "alice",
          scopes: ["plan", "run"],
          created_at: "2025-06-07T12:00:00.000Z",
          expires_at: null,
          revoked_at: null,
        },
      ]

      const result = formatDelegationsList(delegations)
      expect(result).toContain("| User |")
      expect(result).toContain("| Scopes |")
      expect(result).toContain("| Delegated By |")
      expect(result).toContain("| Created |")
      expect(result).toContain("@alice")
      expect(result).toContain("`plan`")
      expect(result).toContain("`run`")
      expect(result).toContain("@admin")
      expect(result).toContain("2025-06-07")
    })

    it("produces a table with multiple rows", () => {
      const delegations: DelegationMetadata[] = [
        {
          kind: "delegation",
          issue: 1,
          delegated_by: "admin",
          delegated_to: "alice",
          scopes: ["plan"],
          created_at: "2025-06-07T12:00:00.000Z",
          expires_at: null,
          revoked_at: null,
        },
        {
          kind: "delegation",
          issue: 1,
          delegated_by: "admin",
          delegated_to: "bob",
          scopes: ["run", "retry"],
          created_at: "2025-06-08T12:00:00.000Z",
          expires_at: null,
          revoked_at: null,
        },
      ]

      const result = formatDelegationsList(delegations)
      const lines = result.split("\n")
      // Header + separator + 2 data rows
      expect(lines).toHaveLength(4)
      expect(result).toContain("@alice")
      expect(result).toContain("@bob")
    })

    it("formats scopes as inline code", () => {
      const delegations: DelegationMetadata[] = [
        {
          kind: "delegation",
          issue: 1,
          delegated_by: "admin",
          delegated_to: "alice",
          scopes: ["approve", "run"],
          created_at: "2025-01-15T08:30:00.000Z",
          expires_at: null,
          revoked_at: null,
        },
      ]

      const result = formatDelegationsList(delegations)
      expect(result).toContain("`approve`")
      expect(result).toContain("`run`")
    })
  })

  // ── Constants ──

  describe("constants", () => {
    it("DEFAULT_DELEGATION_SCOPES has expected values", () => {
      expect([...DEFAULT_DELEGATION_SCOPES]).toEqual(["plan", "revise", "approve", "run"])
    })

    it("VALID_DELEGATION_SCOPES includes all defaults plus retry", () => {
      expect([...VALID_DELEGATION_SCOPES]).toEqual(["plan", "revise", "approve", "run", "retry"])
    })

    it("all default scopes are valid scopes", () => {
      const validSet = new Set(VALID_DELEGATION_SCOPES)
      for (const scope of DEFAULT_DELEGATION_SCOPES) {
        expect(validSet.has(scope)).toBe(true)
      }
    })
  })
})
