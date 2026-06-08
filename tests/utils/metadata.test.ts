import { describe, it, expect } from "vitest"
import {
  parseMetadataComment,
  createMetadataComment,
  hasMetadata,
} from "../../src/utils/metadata"
import { verifySignature } from "../../src/security/signing"

const TEST_SECRET = "test-metadata-secret"

describe("metadata", () => {
  describe("createMetadataComment", () => {
    it("creates a comment with metadata block and human body", () => {
      const result = createMetadataComment(
        { action: "plan", issueNumber: 1 },
        "Here is the plan.",
        TEST_SECRET,
      )

      expect(result).toContain("<!-- agent-metadata")
      expect(result).toContain("-->")
      expect(result).toContain("Here is the plan.")
      expect(result).toContain('"action"')
      expect(result).toContain('"signature"')
    })

    it("embeds a valid signature in the metadata", () => {
      const result = createMetadataComment(
        { action: "plan" },
        "body",
        TEST_SECRET,
      )

      // Extract and verify the signature
      const parsed = parseMetadataComment(result)
      expect(parsed).not.toBeNull()
      const metadata = parsed!.metadata as Record<string, any>
      expect(metadata.signature).toBeDefined()
      expect(verifySignature(metadata, TEST_SECRET)).toBe(true)
    })
  })

  describe("parseMetadataComment", () => {
    it("parses a valid metadata comment", () => {
      const raw = createMetadataComment(
        { action: "plan", version: 1 },
        "Human readable content",
        TEST_SECRET,
      )

      const result = parseMetadataComment(raw)
      expect(result).not.toBeNull()
      expect(result!.metadata).toHaveProperty("action", "plan")
      expect(result!.metadata).toHaveProperty("version", 1)
      expect(result!.metadata).toHaveProperty("signature")
      expect(result!.body).toBe("Human readable content")
      expect(result!.raw).toBe(raw)
    })

    it("returns null for comments without metadata", () => {
      const result = parseMetadataComment("Just a regular comment")
      expect(result).toBeNull()
    })

    it("returns null for malformed JSON in metadata block", () => {
      const raw = "<!-- agent-metadata\n{invalid json}\n-->\n\nBody"
      const result = parseMetadataComment(raw)
      expect(result).toBeNull()
    })

    it("handles multiline human body", () => {
      const body = "Line 1\nLine 2\n\nLine 4"
      const raw = createMetadataComment({ action: "test" }, body, TEST_SECRET)
      const result = parseMetadataComment(raw)
      expect(result).not.toBeNull()
      expect(result!.body).toBe(body)
    })

    it("handles empty human body", () => {
      const raw = createMetadataComment({ action: "test" }, "", TEST_SECRET)
      const result = parseMetadataComment(raw)
      expect(result).not.toBeNull()
      expect(result!.body).toBe("")
    })

    it("handles metadata with complex nested objects", () => {
      const metadata = {
        action: "plan",
        config: { steps: ["a", "b"], nested: { deep: true } },
      }
      const raw = createMetadataComment(metadata, "body", TEST_SECRET)
      const result = parseMetadataComment(raw)
      expect(result).not.toBeNull()
      expect(result!.metadata).toHaveProperty("config")
      const config = (result!.metadata as any).config
      expect(config.steps).toEqual(["a", "b"])
      expect(config.nested.deep).toBe(true)
    })
  })

  describe("hasMetadata", () => {
    it("returns true for comments with metadata", () => {
      const raw = createMetadataComment({ action: "test" }, "body", TEST_SECRET)
      expect(hasMetadata(raw)).toBe(true)
    })

    it("returns false for plain comments", () => {
      expect(hasMetadata("Just a normal comment")).toBe(false)
    })

    it("returns false for non-agent HTML comments", () => {
      expect(hasMetadata("<!-- not agent metadata -->")).toBe(false)
    })

    it("returns true for manually constructed metadata block", () => {
      const raw = '<!-- agent-metadata\n{"key": "value"}\n-->\n\nBody'
      expect(hasMetadata(raw)).toBe(true)
    })
  })

  describe("round trip", () => {
    it("create -> parse -> verify produces valid result", () => {
      const originalMetadata = {
        action: "plan_approved",
        issueNumber: 42,
        repo: "owner/repo",
        timestamp: "2024-01-01T00:00:00Z",
      }
      const humanBody = "## Plan Approved\n\nThe plan has been approved and execution will begin."

      const raw = createMetadataComment(originalMetadata, humanBody, TEST_SECRET)
      const parsed = parseMetadataComment(raw)

      expect(parsed).not.toBeNull()
      expect(parsed!.body).toBe(humanBody)
      expect(parsed!.metadata).toHaveProperty("action", "plan_approved")
      expect(parsed!.metadata).toHaveProperty("issueNumber", 42)

      // Verify signature
      const metadata = parsed!.metadata as Record<string, any>
      expect(verifySignature(metadata, TEST_SECRET)).toBe(true)
    })

    it("tampering with parsed metadata breaks verification", () => {
      const raw = createMetadataComment(
        { action: "plan", issueNumber: 1 },
        "body",
        TEST_SECRET,
      )
      const parsed = parseMetadataComment(raw)!
      const metadata = parsed.metadata as Record<string, any>

      // Tamper
      metadata.issueNumber = 999
      expect(verifySignature(metadata, TEST_SECRET)).toBe(false)
    })
  })
})
