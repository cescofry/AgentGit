import { describe, it, expect } from "vitest"
import {
  createPlanComment,
  createStatusComment,
  createBlockedComment,
  createSecurityLockComment,
} from "../../src/github/comments"
import { parseMetadataComment } from "../../src/utils/metadata"
import { verifySignature } from "../../src/security/signing"

const SIGNING_SECRET = "test-signing-secret-abc123"

// ── Tests ──

describe("createPlanComment", () => {
  it("contains signed metadata", () => {
    const comment = createPlanComment(
      "Step 1: Do X\nStep 2: Do Y",
      1,
      42,
      "opencode",
      "claude-sonnet",
      SIGNING_SECRET,
    )

    const parsed = parseMetadataComment(comment)
    expect(parsed).not.toBeNull()
    expect(parsed!.metadata.kind).toBe("plan")
    expect(parsed!.metadata.issue).toBe(42)
    expect(parsed!.metadata.plan_version).toBe(1)
    expect(parsed!.metadata.harness).toBe("opencode")
    expect(parsed!.metadata.model).toBe("claude-sonnet")
    expect(parsed!.metadata.signature).toBeTruthy()
  })

  it("has valid signature", () => {
    const comment = createPlanComment(
      "My plan",
      1,
      42,
      "opencode",
      "claude-sonnet",
      SIGNING_SECRET,
    )

    const parsed = parseMetadataComment(comment)
    expect(parsed).not.toBeNull()
    expect(verifySignature(parsed!.metadata as Record<string, any>, SIGNING_SECRET)).toBe(true)
  })

  it("has invalid signature with wrong secret", () => {
    const comment = createPlanComment(
      "My plan",
      1,
      42,
      "opencode",
      "claude-sonnet",
      SIGNING_SECRET,
    )

    const parsed = parseMetadataComment(comment)
    expect(parsed).not.toBeNull()
    expect(verifySignature(parsed!.metadata as Record<string, any>, "wrong-secret")).toBe(false)
  })

  it("has human-readable plan text", () => {
    const plan = "Step 1: Do X\nStep 2: Do Y"
    const comment = createPlanComment(plan, 1, 42, "opencode", "claude-sonnet", SIGNING_SECRET)

    const parsed = parseMetadataComment(comment)
    expect(parsed).not.toBeNull()
    expect(parsed!.body).toContain("Proposed Plan (v1)")
    expect(parsed!.body).toContain("Step 1: Do X")
    expect(parsed!.body).toContain("Step 2: Do Y")
    expect(parsed!.body).toContain("/approve")
  })

  it("increments plan version in heading", () => {
    const comment = createPlanComment("Plan v3", 3, 42, "opencode", "claude-sonnet", SIGNING_SECRET)

    const parsed = parseMetadataComment(comment)
    expect(parsed).not.toBeNull()
    expect(parsed!.body).toContain("Proposed Plan (v3)")
    expect(parsed!.metadata.plan_version).toBe(3)
  })
})

describe("createStatusComment", () => {
  it("is plain text with status", () => {
    const comment = createStatusComment("Planning")

    expect(comment).toContain("**Status:** Planning")
    // No metadata block
    const parsed = parseMetadataComment(comment)
    expect(parsed).toBeNull()
  })

  it("includes details when provided", () => {
    const comment = createStatusComment("Executing", "Running tests on branch agent/42")

    expect(comment).toContain("**Status:** Executing")
    expect(comment).toContain("Running tests on branch agent/42")
  })

  it("omits details section when not provided", () => {
    const comment = createStatusComment("Waiting for approval")

    expect(comment).toBe("**Status:** Waiting for approval")
  })
})

describe("createBlockedComment", () => {
  it("has metadata with failure reason", () => {
    const comment = createBlockedComment(
      42,
      "Test suite failed with 3 errors",
      "execution",
      SIGNING_SECRET,
    )

    const parsed = parseMetadataComment(comment)
    expect(parsed).not.toBeNull()
    expect(parsed!.metadata.kind).toBe("blocked")
    expect(parsed!.metadata.issue).toBe(42)
    expect(parsed!.metadata.failed_phase).toBe("execution")
    expect(parsed!.metadata.signature).toBeTruthy()
  })

  it("has valid signature", () => {
    const comment = createBlockedComment(42, "Out of retries", "planning", SIGNING_SECRET)

    const parsed = parseMetadataComment(comment)
    expect(parsed).not.toBeNull()
    expect(verifySignature(parsed!.metadata as Record<string, any>, SIGNING_SECRET)).toBe(true)
  })

  it("has human-readable blocked text", () => {
    const comment = createBlockedComment(
      42,
      "Test suite failed with 3 errors",
      "execution",
      SIGNING_SECRET,
    )

    const parsed = parseMetadataComment(comment)
    expect(parsed).not.toBeNull()
    expect(parsed!.body).toContain("Blocked")
    expect(parsed!.body).toContain("execution")
    expect(parsed!.body).toContain("Test suite failed with 3 errors")
    expect(parsed!.body).toContain("admin")
  })
})

describe("createSecurityLockComment", () => {
  it("has metadata with category", () => {
    const comment = createSecurityLockComment(
      42,
      "credential_theft",
      "Issue requests reading .env secrets",
      SIGNING_SECRET,
    )

    const parsed = parseMetadataComment(comment)
    expect(parsed).not.toBeNull()
    expect(parsed!.metadata.kind).toBe("security-lock")
    expect(parsed!.metadata.issue).toBe(42)
    expect(parsed!.metadata.category).toBe("credential_theft")
    expect(parsed!.metadata.signature).toBeTruthy()
  })

  it("has valid signature", () => {
    const comment = createSecurityLockComment(
      42,
      "data_exfiltration",
      "Suspicious data transfer request",
      SIGNING_SECRET,
    )

    const parsed = parseMetadataComment(comment)
    expect(parsed).not.toBeNull()
    expect(verifySignature(parsed!.metadata as Record<string, any>, SIGNING_SECRET)).toBe(true)
  })

  it("has human-readable security lock text", () => {
    const comment = createSecurityLockComment(
      42,
      "malware",
      "Issue requests downloading and executing binary",
      SIGNING_SECRET,
    )

    const parsed = parseMetadataComment(comment)
    expect(parsed).not.toBeNull()
    expect(parsed!.body).toContain("Security Lock")
    expect(parsed!.body).toContain("malware")
    expect(parsed!.body).toContain("downloading and executing binary")
    expect(parsed!.body).toContain("security admin")
  })

  it("has invalid signature with wrong secret", () => {
    const comment = createSecurityLockComment(
      42,
      "abuse",
      "Potentially abusive request",
      SIGNING_SECRET,
    )

    const parsed = parseMetadataComment(comment)
    expect(parsed).not.toBeNull()
    expect(verifySignature(parsed!.metadata as Record<string, any>, "wrong-secret")).toBe(false)
  })
})
