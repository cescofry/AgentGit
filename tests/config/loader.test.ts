import { describe, it, expect } from "vitest"
import * as yaml from "js-yaml"
import { loadConfig, mergeConfig } from "../../src/config/loader"
import { DEFAULT_CONFIG, AgentGitConfig } from "../../src/config/defaults"

// ── Helpers ──

/**
 * Build a mock octokit that returns file content for specific paths
 * and 404 for everything else.
 */
function mockOctokit(files: Record<string, string>) {
  return {
    rest: {
      repos: {
        getContent: async (params: { owner: string; repo: string; path: string; ref?: string }) => {
          const content = files[params.path]
          if (content === undefined) {
            const err: any = new Error("Not Found")
            err.status = 404
            throw err
          }
          return {
            data: {
              content: Buffer.from(content).toString("base64"),
              encoding: "base64",
            },
          }
        },
      },
    },
  }
}

// ── Tests ──

describe("loadConfig", () => {
  describe("missing config produces valid defaults", () => {
    it("returns default config when no config files exist", async () => {
      const octokit = mockOctokit({})
      const result = await loadConfig(octokit, "owner", "repo")

      expect(result.config).toEqual(DEFAULT_CONFIG)
      expect(result.source).toBe("defaults")
      expect(result.warnings).toEqual([])
    })

    it("returns default config when octokit is null and no localPath", async () => {
      const result = await loadConfig(null, "owner", "repo")

      expect(result.config).toEqual(DEFAULT_CONFIG)
      expect(result.source).toBe("defaults")
    })
  })

  describe("partial config merges correctly", () => {
    it("merges partial execution config with defaults", async () => {
      const partialConfig = yaml.dump({
        execution: {
          harness: "pi",
          max_runtime_minutes: 120,
        },
      })
      const octokit = mockOctokit({
        ".agentGit/config.yml": partialConfig,
      })

      const result = await loadConfig(octokit, "owner", "repo")

      expect(result.config.execution.harness).toBe("pi")
      expect(result.config.execution.max_runtime_minutes).toBe(120)
      // Defaults preserved for unset fields
      expect(result.config.execution.model).toBe(DEFAULT_CONFIG.execution.model)
      expect(result.config.execution.branch_prefix).toBe(DEFAULT_CONFIG.execution.branch_prefix)
      expect(result.config.enabled).toBe(true)
      expect(result.source).toBe(".agentGit/config.yml")
    })

    it("merges partial approval config with defaults", async () => {
      const partialConfig = yaml.dump({
        approval: {
          allowed_users: ["alice", "bob"],
        },
      })
      const octokit = mockOctokit({
        ".agentGit/config.yml": partialConfig,
      })

      const result = await loadConfig(octokit, "owner", "repo")

      expect(result.config.approval.allowed_users).toEqual(["alice", "bob"])
      // Default delegation settings preserved
      expect(result.config.approval.delegation.enabled).toBe(true)
      expect(result.config.approval.required_permissions).toEqual(["admin", "maintain"])
    })

    it("overrides scalar values while preserving nested defaults", async () => {
      const partialConfig = yaml.dump({
        enabled: false,
        security: {
          security_admins: ["secadmin"],
        },
      })
      const octokit = mockOctokit({
        ".agentGit/config.yml": partialConfig,
      })

      const result = await loadConfig(octokit, "owner", "repo")

      expect(result.config.enabled).toBe(false)
      expect(result.config.security.security_admins).toEqual(["secadmin"])
      // Default pre_plan_check preserved
      expect(result.config.security.pre_plan_check.enabled).toBe(true)
      expect(result.config.security.disallowed_categories).toEqual(
        DEFAULT_CONFIG.security.disallowed_categories,
      )
    })
  })

  describe("invalid config returns validation errors", () => {
    it("falls back to defaults when harness is invalid", async () => {
      const invalidConfig = yaml.dump({
        execution: {
          harness: "invalid-harness",
        },
      })
      const octokit = mockOctokit({
        ".agentGit/config.yml": invalidConfig,
      })

      const result = await loadConfig(octokit, "owner", "repo")

      // Should fall back to defaults because of validation error
      expect(result.config).toEqual(DEFAULT_CONFIG)
      expect(result.warnings.length).toBeGreaterThan(0)
      expect(result.warnings.some((w) => w.includes("harness"))).toBe(true)
    })

    it("falls back to defaults when enabled is not boolean", async () => {
      const invalidConfig = yaml.dump({
        enabled: "yes",
      })
      const octokit = mockOctokit({
        ".agentGit/config.yml": invalidConfig,
      })

      const result = await loadConfig(octokit, "owner", "repo")

      expect(result.config).toEqual(DEFAULT_CONFIG)
      expect(result.warnings.some((w) => w.includes("enabled"))).toBe(true)
    })

    it("falls back to defaults when max_runtime_minutes is negative", async () => {
      const invalidConfig = yaml.dump({
        execution: {
          max_runtime_minutes: -5,
        },
      })
      const octokit = mockOctokit({
        ".agentGit/config.yml": invalidConfig,
      })

      const result = await loadConfig(octokit, "owner", "repo")

      expect(result.config).toEqual(DEFAULT_CONFIG)
      expect(result.warnings.some((w) => w.includes("max_runtime_minutes"))).toBe(true)
    })
  })

  describe("YAML parsing works for valid config", () => {
    it("parses a complete valid YAML config", async () => {
      const fullConfig = yaml.dump({
        enabled: true,
        ready_labels: ["agent:ready", "custom:ready"],
        approval: {
          required_permissions: ["admin"],
          allowed_users: ["alice"],
          delegation: {
            enabled: false,
            min_delegator_permission: "admin",
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
          security_admins: ["secops"],
          disallowed_categories: ["malware", "abuse"],
        },
        task_types: {
          bug: { labels: ["bug"] },
          feature: { labels: ["enhancement"] },
        },
        execution: {
          harness: "opencode",
          model: "anthropic/claude-sonnet-4-20250514",
          plan_model: "anthropic/claude-sonnet-4-20250514",
          test_command: "npm test",
          max_runtime_minutes: 30,
          branch_prefix: "bot/",
          auto_run_tests: true,
          max_plan_revisions: 3,
        },
        execution_environment: {
          workspace_root: "/var/agentgit",
          cleanup_on_success: true,
          cleanup_on_failure: true,
        },
      })

      const octokit = mockOctokit({
        ".agentGit/config.yml": fullConfig,
      })

      const result = await loadConfig(octokit, "owner", "repo")

      expect(result.warnings).toEqual([])
      expect(result.config.ready_labels).toEqual(["agent:ready", "custom:ready"])
      expect(result.config.execution.branch_prefix).toBe("bot/")
      expect(result.config.execution.max_runtime_minutes).toBe(30)
      expect(result.config.security.disallowed_categories).toEqual(["malware", "abuse"])
    })

    it("handles malformed YAML gracefully", async () => {
      // js-yaml parses ":::bad yaml{{{" as a plain string, not as an object.
      // The loader detects this (not an object) and falls back to defaults.
      const octokit = mockOctokit({
        ".agentGit/config.yml": ":::bad yaml{{{",
      })

      const result = await loadConfig(octokit, "owner", "repo")

      expect(result.config).toEqual(DEFAULT_CONFIG)
      expect(result.warnings.some((w) => w.includes("not an object"))).toBe(true)
    })

    it("handles empty YAML file", async () => {
      const octokit = mockOctokit({
        ".agentGit/config.yml": "",
      })

      const result = await loadConfig(octokit, "owner", "repo")

      expect(result.config).toEqual(DEFAULT_CONFIG)
      expect(result.warnings.some((w) => w.includes("empty"))).toBe(true)
    })
  })

  describe(".agentGit/config.yml takes priority over .github/agentgit.yml", () => {
    it("uses .agentGit/config.yml when both exist", async () => {
      const primaryConfig = yaml.dump({
        execution: { branch_prefix: "primary/" },
      })
      const fallbackConfig = yaml.dump({
        execution: { branch_prefix: "fallback/" },
      })
      const octokit = mockOctokit({
        ".agentGit/config.yml": primaryConfig,
        ".github/agentgit.yml": fallbackConfig,
      })

      const result = await loadConfig(octokit, "owner", "repo")

      expect(result.source).toBe(".agentGit/config.yml")
      expect(result.config.execution.branch_prefix).toBe("primary/")
    })

    it("falls back to .github/agentgit.yml when .agentGit/config.yml is missing", async () => {
      const fallbackConfig = yaml.dump({
        execution: { branch_prefix: "fallback/" },
      })
      const octokit = mockOctokit({
        ".github/agentgit.yml": fallbackConfig,
      })

      const result = await loadConfig(octokit, "owner", "repo")

      expect(result.source).toBe(".github/agentgit.yml")
      expect(result.config.execution.branch_prefix).toBe("fallback/")
    })
  })
})

describe("mergeConfig", () => {
  it("returns defaults when user config is empty", () => {
    const result = mergeConfig({}, DEFAULT_CONFIG)
    expect(result).toEqual(DEFAULT_CONFIG)
  })

  it("user scalar values override defaults", () => {
    const result = mergeConfig({ enabled: false } as Partial<AgentGitConfig>, DEFAULT_CONFIG)
    expect(result.enabled).toBe(false)
    // Other defaults preserved
    expect(result.execution.harness).toBe("opencode")
  })

  it("user nested objects merge with defaults", () => {
    const result = mergeConfig(
      {
        execution: {
          harness: "pi",
          model: "custom-model",
          plan_model: DEFAULT_CONFIG.execution.plan_model,
          test_command: DEFAULT_CONFIG.execution.test_command,
          max_runtime_minutes: DEFAULT_CONFIG.execution.max_runtime_minutes,
          branch_prefix: DEFAULT_CONFIG.execution.branch_prefix,
          auto_run_tests: DEFAULT_CONFIG.execution.auto_run_tests,
          max_plan_revisions: DEFAULT_CONFIG.execution.max_plan_revisions,
        },
      } as Partial<AgentGitConfig>,
      DEFAULT_CONFIG,
    )
    expect(result.execution.harness).toBe("pi")
    expect(result.execution.model).toBe("custom-model")
  })

  it("user arrays replace default arrays entirely", () => {
    const result = mergeConfig(
      { ready_labels: ["custom:label"] } as Partial<AgentGitConfig>,
      DEFAULT_CONFIG,
    )
    expect(result.ready_labels).toEqual(["custom:label"])
  })
})
