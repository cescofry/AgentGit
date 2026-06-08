import { describe, it, expect } from "vitest"
import { isBotComment, verifyCommentProvenance } from "../../src/github/identity"
import { createMetadataComment } from "../../src/utils/metadata"
import { signMetadata } from "../../src/security/signing"

const APP_SLUG = "agentgit"
const SIGNING_SECRET = "test-identity-secret"

describe("identity", () => {
  describe("isBotComment", () => {
    it("returns true for a matching bot comment", () => {
      const comment = {
        user: { login: "agentgit[bot]", type: "Bot" },
      }
      expect(isBotComment(comment, APP_SLUG)).toBe(true)
    })

    it("returns false for a human user", () => {
      const comment = {
        user: { login: "some-user", type: "User" },
      }
      expect(isBotComment(comment, APP_SLUG)).toBe(false)
    })

    it("returns false for a different bot", () => {
      const comment = {
        user: { login: "other-bot[bot]", type: "Bot" },
      }
      expect(isBotComment(comment, APP_SLUG)).toBe(false)
    })

    it("returns false when type is Bot but login doesn't match pattern", () => {
      const comment = {
        user: { login: "agentgit", type: "Bot" },
      }
      expect(isBotComment(comment, APP_SLUG)).toBe(false)
    })

    it("returns false when login matches but type is not Bot", () => {
      const comment = {
        user: { login: "agentgit[bot]", type: "User" },
      }
      expect(isBotComment(comment, APP_SLUG)).toBe(false)
    })

    it("works with different app slugs", () => {
      const comment = {
        user: { login: "my-custom-app[bot]", type: "Bot" },
      }
      expect(isBotComment(comment, "my-custom-app")).toBe(true)
      expect(isBotComment(comment, "wrong-slug")).toBe(false)
    })
  })

  describe("verifyCommentProvenance", () => {
    function makeBotComment(body: string) {
      return {
        user: { login: "agentgit[bot]", type: "Bot" as const },
        body,
      }
    }

    function makeUserComment(body: string) {
      return {
        user: { login: "some-user", type: "User" as const },
        body,
      }
    }

    it("returns valid for a correctly signed bot comment", () => {
      const body = createMetadataComment(
        { action: "plan", issueNumber: 1 },
        "Plan details here",
        SIGNING_SECRET,
      )
      const comment = makeBotComment(body)
      const result = verifyCommentProvenance(comment, APP_SLUG, SIGNING_SECRET)
      expect(result.valid).toBe(true)
      expect(result.reason).toBeUndefined()
    })

    it("rejects when author is not the bot", () => {
      const body = createMetadataComment(
        { action: "plan" },
        "Plan",
        SIGNING_SECRET,
      )
      const comment = makeUserComment(body)
      const result = verifyCommentProvenance(comment, APP_SLUG, SIGNING_SECRET)
      expect(result.valid).toBe(false)
      expect(result.reason).toContain("some-user")
    })

    it("rejects when comment has no metadata", () => {
      const comment = makeBotComment("Just a plain comment without metadata")
      const result = verifyCommentProvenance(comment, APP_SLUG, SIGNING_SECRET)
      expect(result.valid).toBe(false)
      expect(result.reason).toContain("does not contain agent metadata")
    })

    it("rejects when metadata has no signature", () => {
      // Manually craft a comment with metadata but no signature
      const body = '<!-- agent-metadata\n{"action":"plan"}\n-->\n\nBody'
      const comment = makeBotComment(body)
      const result = verifyCommentProvenance(comment, APP_SLUG, SIGNING_SECRET)
      expect(result.valid).toBe(false)
      expect(result.reason).toContain("missing signature")
    })

    it("rejects when signature is invalid (tampered data)", () => {
      // Create a valid comment, then tamper with the metadata in the raw body
      const metadata = { action: "plan", issueNumber: 1 }
      const signature = signMetadata(metadata, SIGNING_SECRET)
      // Embed with wrong action value but same signature
      const tamperedJson = JSON.stringify({
        action: "execute",
        issueNumber: 1,
        signature,
      }, null, 2)
      const body = `<!-- agent-metadata\n${tamperedJson}\n-->\n\nBody`
      const comment = makeBotComment(body)
      const result = verifyCommentProvenance(comment, APP_SLUG, SIGNING_SECRET)
      expect(result.valid).toBe(false)
      expect(result.reason).toContain("signature verification failed")
    })

    it("rejects when signed with a different secret", () => {
      const body = createMetadataComment(
        { action: "plan" },
        "Body",
        "different-secret",
      )
      const comment = makeBotComment(body)
      const result = verifyCommentProvenance(comment, APP_SLUG, SIGNING_SECRET)
      expect(result.valid).toBe(false)
      expect(result.reason).toContain("signature verification failed")
    })
  })
})
