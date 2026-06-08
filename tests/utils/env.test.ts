import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { loadEnv, validateEnv } from "../../src/utils/env"

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs")
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    readFileSync: vi.fn(actual.readFileSync),
  }
})

// Import fs after mock setup so we get the mocked version
import * as fs from "fs"

describe("env", () => {
  const originalEnv = process.env

  beforeEach(() => {
    // Reset env to a clean slate before each test
    process.env = { ...originalEnv }
    // Clear all agentgit-related vars
    delete process.env.GITHUB_APP_ID
    delete process.env.GITHUB_APP_PRIVATE_KEY
    delete process.env.GITHUB_APP_PRIVATE_KEY_PATH
    delete process.env.GITHUB_WEBHOOK_SECRET
    delete process.env.AGENTGIT_SIGNING_SECRET
    delete process.env.AGENTGIT_PORT
    delete process.env.AGENTGIT_LOG_LEVEL
  })

  afterEach(() => {
    process.env = originalEnv
    vi.restoreAllMocks()
  })

  function setRequiredEnv() {
    process.env.GITHUB_APP_ID = "12345"
    process.env.GITHUB_APP_PRIVATE_KEY = "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----"
    process.env.GITHUB_WEBHOOK_SECRET = "webhook-secret"
    process.env.AGENTGIT_SIGNING_SECRET = "signing-secret"
  }

  describe("validateEnv", () => {
    it("reports all missing vars when env is empty", () => {
      const result = validateEnv()
      expect(result.valid).toBe(false)
      expect(result.missing).toContain("GITHUB_APP_ID")
      expect(result.missing).toContain("GITHUB_WEBHOOK_SECRET")
      expect(result.missing).toContain("AGENTGIT_SIGNING_SECRET")
      expect(result.missing.some((m) => m.includes("GITHUB_APP_PRIVATE_KEY"))).toBe(true)
    })

    it("returns valid when all required vars are set", () => {
      setRequiredEnv()
      const result = validateEnv()
      expect(result.valid).toBe(true)
      expect(result.missing).toHaveLength(0)
    })

    it("partial mode always returns valid even with missing vars", () => {
      const result = validateEnv(true)
      expect(result.valid).toBe(true)
      expect(result.missing.length).toBeGreaterThan(0)
    })

    it("warns when optional AGENTGIT_PORT is not set", () => {
      setRequiredEnv()
      const result = validateEnv()
      expect(result.warnings.some((w) => w.includes("AGENTGIT_PORT"))).toBe(true)
    })

    it("warns when AGENTGIT_LOG_LEVEL is invalid", () => {
      setRequiredEnv()
      process.env.AGENTGIT_LOG_LEVEL = "verbose"
      const result = validateEnv()
      expect(result.warnings.some((w) => w.includes("verbose"))).toBe(true)
    })

    it("accepts GITHUB_APP_PRIVATE_KEY_PATH as alternative to inline key", () => {
      process.env.GITHUB_APP_ID = "12345"
      process.env.GITHUB_APP_PRIVATE_KEY_PATH = "/tmp/fake-key.pem"
      process.env.GITHUB_WEBHOOK_SECRET = "webhook-secret"
      process.env.AGENTGIT_SIGNING_SECRET = "signing-secret"
      const result = validateEnv()
      expect(result.valid).toBe(true)
      expect(result.missing.some((m) => m.includes("PRIVATE_KEY"))).toBe(false)
    })
  })

  describe("loadEnv", () => {
    it("throws when required vars are missing", () => {
      expect(() => loadEnv()).toThrow("Missing required environment variables")
    })

    it("loads all vars correctly with inline private key", () => {
      setRequiredEnv()
      const config = loadEnv()
      expect(config.GITHUB_APP_ID).toBe("12345")
      expect(config.GITHUB_APP_PRIVATE_KEY).toContain("RSA PRIVATE KEY")
      expect(config.GITHUB_WEBHOOK_SECRET).toBe("webhook-secret")
      expect(config.AGENTGIT_SIGNING_SECRET).toBe("signing-secret")
      expect(config.AGENTGIT_PORT).toBe(3000) // default
      expect(config.AGENTGIT_LOG_LEVEL).toBe("info") // default
    })

    it("reads private key from file path", () => {
      const fakePem = "-----BEGIN RSA PRIVATE KEY-----\nfile-content\n-----END RSA PRIVATE KEY-----"
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue(fakePem)

      process.env.GITHUB_APP_ID = "12345"
      process.env.GITHUB_APP_PRIVATE_KEY_PATH = "/tmp/key.pem"
      process.env.GITHUB_WEBHOOK_SECRET = "webhook-secret"
      process.env.AGENTGIT_SIGNING_SECRET = "signing-secret"

      const config = loadEnv()
      expect(config.GITHUB_APP_PRIVATE_KEY).toBe(fakePem)
      expect(fs.readFileSync).toHaveBeenCalledWith("/tmp/key.pem", "utf-8")
    })

    it("throws when key path points to non-existent file", () => {
      process.env.GITHUB_APP_ID = "12345"
      process.env.GITHUB_APP_PRIVATE_KEY_PATH = "/nonexistent/key.pem"
      process.env.GITHUB_WEBHOOK_SECRET = "webhook-secret"
      process.env.AGENTGIT_SIGNING_SECRET = "signing-secret"

      vi.mocked(fs.existsSync).mockReturnValue(false)

      expect(() => loadEnv()).toThrow("non-existent file")
    })

    it("throws when neither inline key nor key path is set", () => {
      process.env.GITHUB_APP_ID = "12345"
      process.env.GITHUB_WEBHOOK_SECRET = "webhook-secret"
      process.env.AGENTGIT_SIGNING_SECRET = "signing-secret"

      expect(() => loadEnv()).toThrow("Missing required environment variables")
    })

    it("parses custom port", () => {
      setRequiredEnv()
      process.env.AGENTGIT_PORT = "8080"
      const config = loadEnv()
      expect(config.AGENTGIT_PORT).toBe(8080)
    })

    it("throws on invalid port", () => {
      setRequiredEnv()
      process.env.AGENTGIT_PORT = "not-a-number"
      expect(() => loadEnv()).toThrow("valid port number")
    })

    it("throws on out-of-range port", () => {
      setRequiredEnv()
      process.env.AGENTGIT_PORT = "99999"
      expect(() => loadEnv()).toThrow("valid port number")
    })

    it("parses custom log level", () => {
      setRequiredEnv()
      process.env.AGENTGIT_LOG_LEVEL = "debug"
      const config = loadEnv()
      expect(config.AGENTGIT_LOG_LEVEL).toBe("debug")
    })

    it("throws on invalid log level", () => {
      setRequiredEnv()
      process.env.AGENTGIT_LOG_LEVEL = "verbose"
      expect(() => loadEnv()).toThrow("must be one of")
    })
  })
})
