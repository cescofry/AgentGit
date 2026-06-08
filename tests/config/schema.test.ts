import { describe, it, expect } from "vitest"
import { validateConfig } from "../../src/config/schema"
import { DEFAULT_CONFIG } from "../../src/config/defaults"

describe("validateConfig", () => {
  describe("valid config passes validation", () => {
    it("accepts the default config", () => {
      const result = validateConfig(DEFAULT_CONFIG)

      expect(result.valid).toBe(true)
      expect(result.errors).toEqual([])
      expect(result.warnings).toEqual([])
    })

    it("accepts a minimal valid config", () => {
      const result = validateConfig({
        enabled: true,
      })

      expect(result.valid).toBe(true)
      expect(result.errors).toEqual([])
    })

    it("accepts a complete valid config", () => {
      const result = validateConfig({
        enabled: true,
        ready_labels: ["agent:ready"],
        approval: {
          required_permissions: ["admin", "maintain"],
          allowed_users: ["alice"],
          delegation: {
            enabled: true,
            min_delegator_permission: "maintain",
            min_delegate_permission: "write",
            allow_delegate_chaining: false,
          },
        },
        security: {
          pre_plan_check: {
            enabled: true,
            lock_on_unsafe: true,
            admin_unlock_required: true,
          },
          security_admins: [],
          disallowed_categories: ["malware", "abuse"],
        },
        task_types: {
          bug: { labels: ["bug"] },
        },
        execution: {
          harness: "opencode",
          model: "anthropic/claude-sonnet-4-20250514",
          plan_model: "anthropic/claude-sonnet-4-20250514",
          test_command: "auto",
          max_runtime_minutes: 60,
          branch_prefix: "agent/",
          auto_run_tests: true,
          max_plan_revisions: 5,
        },
        execution_environment: {
          workspace_root: "/tmp/agentgit",
          cleanup_on_success: true,
          cleanup_on_failure: false,
        },
      })

      expect(result.valid).toBe(true)
      expect(result.errors).toEqual([])
    })

    it("accepts an empty object (all fields are optional for partial configs)", () => {
      const result = validateConfig({})

      expect(result.valid).toBe(true)
      expect(result.errors).toEqual([])
    })
  })

  describe("invalid harness type fails", () => {
    it("rejects unknown harness value", () => {
      const result = validateConfig({
        execution: {
          harness: "invalid-harness",
        },
      })

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes("harness"))).toBe(true)
    })

    it("rejects non-string harness value", () => {
      const result = validateConfig({
        execution: {
          harness: 42,
        },
      })

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes("harness"))).toBe(true)
    })

    it("accepts 'opencode' as valid harness", () => {
      const result = validateConfig({
        execution: { harness: "opencode" },
      })

      expect(result.valid).toBe(true)
    })

    it("accepts 'pi' as valid harness", () => {
      const result = validateConfig({
        execution: { harness: "pi" },
      })

      expect(result.valid).toBe(true)
    })
  })

  describe("missing required fields handled by merge with defaults", () => {
    it("validates partial config without errors (merge fills defaults)", () => {
      const result = validateConfig({
        execution: {
          model: "custom-model",
        },
      })

      // Partial config is valid -- merge with defaults fills in missing fields
      expect(result.valid).toBe(true)
    })

    it("validates config with only enabled field", () => {
      const result = validateConfig({ enabled: true })

      expect(result.valid).toBe(true)
    })

    it("validates config with only security section", () => {
      const result = validateConfig({
        security: {
          security_admins: ["admin1"],
        },
      })

      expect(result.valid).toBe(true)
    })
  })

  describe("invalid permission strings detected", () => {
    it("rejects invalid required_permissions value", () => {
      const result = validateConfig({
        approval: {
          required_permissions: ["admin", "superuser"],
        },
      })

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes("superuser"))).toBe(true)
    })

    it("rejects non-array required_permissions", () => {
      const result = validateConfig({
        approval: {
          required_permissions: "admin",
        },
      })

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes("required_permissions"))).toBe(true)
    })

    it("rejects invalid min_delegator_permission", () => {
      const result = validateConfig({
        approval: {
          delegation: {
            min_delegator_permission: "overlord",
          },
        },
      })

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes("min_delegator_permission"))).toBe(true)
    })

    it("rejects invalid min_delegate_permission", () => {
      const result = validateConfig({
        approval: {
          delegation: {
            min_delegate_permission: "sudo",
          },
        },
      })

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes("min_delegate_permission"))).toBe(true)
    })

    it("accepts valid permission strings", () => {
      const result = validateConfig({
        approval: {
          required_permissions: ["admin", "maintain", "write", "triage", "read"],
          delegation: {
            min_delegator_permission: "maintain",
            min_delegate_permission: "write",
          },
        },
      })

      expect(result.valid).toBe(true)
    })
  })

  describe("disallowed categories validation", () => {
    it("rejects invalid disallowed category", () => {
      const result = validateConfig({
        security: {
          disallowed_categories: ["malware", "hacking"],
        },
      })

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes("hacking"))).toBe(true)
    })

    it("accepts valid disallowed categories", () => {
      const result = validateConfig({
        security: {
          disallowed_categories: [
            "credential_theft",
            "malware",
            "data_exfiltration",
            "abuse",
            "policy_bypass",
            "destructive_change",
          ],
        },
      })

      expect(result.valid).toBe(true)
    })
  })

  describe("unknown top-level keys produce warnings", () => {
    it("warns on unknown top-level key", () => {
      const result = validateConfig({
        enabled: true,
        custom_setting: "value",
      })

      expect(result.valid).toBe(true)
      expect(result.warnings.some((w) => w.includes("custom_setting"))).toBe(true)
    })

    it("warns on multiple unknown keys", () => {
      const result = validateConfig({
        foo: 1,
        bar: 2,
      })

      expect(result.valid).toBe(true)
      expect(result.warnings.length).toBe(2)
    })
  })

  describe("type validation errors", () => {
    it("rejects non-boolean enabled", () => {
      const result = validateConfig({ enabled: "true" })

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes("enabled"))).toBe(true)
    })

    it("rejects non-positive max_runtime_minutes", () => {
      const result = validateConfig({
        execution: { max_runtime_minutes: 0 },
      })

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes("max_runtime_minutes"))).toBe(true)
    })

    it("rejects empty branch_prefix", () => {
      const result = validateConfig({
        execution: { branch_prefix: "" },
      })

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes("branch_prefix"))).toBe(true)
    })

    it("rejects non-object config root", () => {
      const result = validateConfig("not an object")

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes("object"))).toBe(true)
    })

    it("rejects non-array ready_labels", () => {
      const result = validateConfig({ ready_labels: "agent:ready" })

      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes("ready_labels"))).toBe(true)
    })
  })
})
