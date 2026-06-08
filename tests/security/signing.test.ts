import { describe, it, expect } from "vitest"
import {
  signMetadata,
  verifySignature,
  canonicalize,
} from "../../src/security/signing"

const TEST_SECRET = "test-signing-secret-256bit"

describe("signing", () => {
  describe("canonicalize", () => {
    it("sorts keys alphabetically", () => {
      const result = canonicalize({ zebra: 1, apple: 2, mango: 3 })
      expect(result).toBe('{"apple":2,"mango":3,"zebra":1}')
    })

    it("removes the signature field", () => {
      const result = canonicalize({
        action: "plan",
        signature: "should-be-stripped",
        version: 1,
      })
      expect(result).toBe('{"action":"plan","version":1}')
      expect(result).not.toContain("signature")
    })

    it("deep-sorts nested object keys", () => {
      const result = canonicalize({
        outer: { zKey: "z", aKey: "a" },
        alpha: 1,
      })
      const parsed = JSON.parse(result)
      const keys = Object.keys(parsed)
      expect(keys).toEqual(["alpha", "outer"])
      const innerKeys = Object.keys(parsed.outer)
      expect(innerKeys).toEqual(["aKey", "zKey"])
    })

    it("preserves arrays in order", () => {
      const result = canonicalize({ items: [3, 1, 2] })
      expect(result).toBe('{"items":[3,1,2]}')
    })

    it("deep-sorts objects inside arrays", () => {
      const result = canonicalize({
        list: [{ z: 1, a: 2 }],
      })
      expect(result).toBe('{"list":[{"a":2,"z":1}]}')
    })

    it("handles null values", () => {
      const result = canonicalize({ key: null })
      expect(result).toBe('{"key":null}')
    })

    it("handles empty object", () => {
      const result = canonicalize({})
      expect(result).toBe("{}")
    })

    it("handles object with only signature field", () => {
      const result = canonicalize({ signature: "only-this" })
      expect(result).toBe("{}")
    })
  })

  describe("signMetadata", () => {
    it("produces a hex string", () => {
      const sig = signMetadata({ action: "plan" }, TEST_SECRET)
      expect(sig).toMatch(/^[0-9a-f]{64}$/)
    })

    it("produces deterministic signatures", () => {
      const metadata = { action: "plan", issueNumber: 42 }
      const sig1 = signMetadata(metadata, TEST_SECRET)
      const sig2 = signMetadata(metadata, TEST_SECRET)
      expect(sig1).toBe(sig2)
    })

    it("different data produces different signatures", () => {
      const sig1 = signMetadata({ action: "plan" }, TEST_SECRET)
      const sig2 = signMetadata({ action: "execute" }, TEST_SECRET)
      expect(sig1).not.toBe(sig2)
    })

    it("different secrets produce different signatures", () => {
      const metadata = { action: "plan" }
      const sig1 = signMetadata(metadata, "secret-1")
      const sig2 = signMetadata(metadata, "secret-2")
      expect(sig1).not.toBe(sig2)
    })

    it("ignores existing signature field in input", () => {
      const metadata = { action: "plan", signature: "old-sig" }
      const sigWithOld = signMetadata(metadata, TEST_SECRET)
      const sigWithout = signMetadata({ action: "plan" }, TEST_SECRET)
      expect(sigWithOld).toBe(sigWithout)
    })
  })

  describe("verifySignature", () => {
    it("verifies a correctly signed metadata object", () => {
      const metadata = { action: "plan", issueNumber: 42 }
      const signature = signMetadata(metadata, TEST_SECRET)
      expect(verifySignature({ ...metadata, signature }, TEST_SECRET)).toBe(true)
    })

    it("rejects tampered metadata", () => {
      const metadata = { action: "plan", issueNumber: 42 }
      const signature = signMetadata(metadata, TEST_SECRET)
      // Tamper with the data
      const tampered = { action: "execute", issueNumber: 42, signature }
      expect(verifySignature(tampered, TEST_SECRET)).toBe(false)
    })

    it("rejects when signature is missing", () => {
      const metadata = { action: "plan" }
      expect(verifySignature(metadata, TEST_SECRET)).toBe(false)
    })

    it("rejects when signature is empty string", () => {
      const metadata = { action: "plan", signature: "" }
      expect(verifySignature(metadata, TEST_SECRET)).toBe(false)
    })

    it("rejects with wrong secret", () => {
      const metadata = { action: "plan" }
      const signature = signMetadata(metadata, TEST_SECRET)
      expect(verifySignature({ ...metadata, signature }, "wrong-secret")).toBe(false)
    })

    it("rejects a completely fake signature", () => {
      const metadata = { action: "plan", signature: "deadbeef".repeat(8) }
      expect(verifySignature(metadata, TEST_SECRET)).toBe(false)
    })

    it("rejects a signature with invalid hex (different length)", () => {
      const metadata = { action: "plan", signature: "not-valid-hex" }
      expect(verifySignature(metadata, TEST_SECRET)).toBe(false)
    })

    it("round-trips through sign and verify", () => {
      const testCases = [
        { simple: true },
        { nested: { deep: { value: 42 } }, array: [1, 2, 3] },
        { unicode: "hello \u00e9\u00e8\u00ea", special: "a&b=c" },
      ]

      for (const metadata of testCases) {
        const signature = signMetadata(metadata, TEST_SECRET)
        expect(verifySignature({ ...metadata, signature }, TEST_SECRET)).toBe(true)
      }
    })
  })
})
