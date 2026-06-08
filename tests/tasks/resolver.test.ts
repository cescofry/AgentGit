import { describe, it, expect } from "vitest"
import { resolveReference, resolveInputs, ResolutionContext } from "../../src/tasks/resolver"
import { IssueContext } from "../../src/harness/interface"
import { DEFAULT_CONFIG } from "../../src/config/defaults"

// ── Fixtures ──

function makeIssueContext(overrides?: Partial<IssueContext>): IssueContext {
  return {
    issueNumber: 42,
    issueTitle: "Fix login bug",
    issueBody: "The login form crashes.",
    comments: [],
    labels: ["bug"],
    repoUrl: "https://github.com/acme/app",
    repoOwner: "acme",
    repoName: "app",
    ...overrides,
  }
}

function makeContext(overrides?: Partial<ResolutionContext>): ResolutionContext {
  return {
    issue: makeIssueContext(),
    config: { ...DEFAULT_CONFIG },
    plan: "Approved plan text.",
    phases: {},
    ...overrides,
  }
}

// ── Tests ──

describe("resolveReference", () => {
  describe("non-$ values", () => {
    it("returns plain strings as-is", () => {
      const ctx = makeContext()
      expect(resolveReference("hello", ctx)).toBe("hello")
    })

    it("returns empty string as-is", () => {
      const ctx = makeContext()
      expect(resolveReference("", ctx)).toBe("")
    })

    it("returns non-string values as-is", () => {
      const ctx = makeContext()
      expect(resolveReference(42 as any, ctx)).toBe(42)
    })
  })

  describe("$issue", () => {
    it("resolves $issue to the full issue context", () => {
      const ctx = makeContext()
      expect(resolveReference("$issue", ctx)).toBe(ctx.issue)
    })

    it("resolves $issue.issueNumber to the issue number", () => {
      const ctx = makeContext()
      expect(resolveReference("$issue.issueNumber", ctx)).toBe(42)
    })

    it("resolves $issue.repoOwner to the repo owner", () => {
      const ctx = makeContext()
      expect(resolveReference("$issue.repoOwner", ctx)).toBe("acme")
    })

    it("throws for unknown issue field", () => {
      const ctx = makeContext()
      expect(() => resolveReference("$issue.nonexistent", ctx)).toThrow(
        'Reference "$issue.nonexistent" resolved to undefined',
      )
    })
  })

  describe("$config", () => {
    it("resolves $config to the full config", () => {
      const ctx = makeContext()
      expect(resolveReference("$config", ctx)).toBe(ctx.config)
    })

    it("resolves $config.execution.harness to nested value", () => {
      const ctx = makeContext()
      expect(resolveReference("$config.execution.harness", ctx)).toBe(
        "opencode",
      )
    })

    it("resolves $config.execution.max_runtime_minutes", () => {
      const ctx = makeContext()
      expect(
        resolveReference("$config.execution.max_runtime_minutes", ctx),
      ).toBe(60)
    })

    it("resolves $config.security.disallowed_categories to an array", () => {
      const ctx = makeContext()
      const result = resolveReference(
        "$config.security.disallowed_categories",
        ctx,
      )
      expect(Array.isArray(result)).toBe(true)
      expect(result).toContain("credential_theft")
    })

    it("throws for unknown config path", () => {
      const ctx = makeContext()
      expect(() =>
        resolveReference("$config.nonexistent.deep.path", ctx),
      ).toThrow('Reference "$config.nonexistent.deep.path" resolved to undefined')
    })
  })

  describe("$plan", () => {
    it("resolves $plan to the plan text", () => {
      const ctx = makeContext({ plan: "My approved plan." })
      expect(resolveReference("$plan", ctx)).toBe("My approved plan.")
    })

    it("returns undefined when plan is not set", () => {
      const ctx = makeContext({ plan: undefined })
      expect(resolveReference("$plan", ctx)).toBeUndefined()
    })

    it("throws for sub-paths on $plan", () => {
      const ctx = makeContext()
      expect(() => resolveReference("$plan.something", ctx)).toThrow(
        "$plan does not have sub-paths",
      )
    })
  })

  describe("$phases", () => {
    it("resolves $phases.NAME.result to phase data", () => {
      const ctx = makeContext({
        phases: {
          "classify-issue": {
            success: true,
            data: { task_type: "bug", instructions: "Fix it." },
            warnings: [],
          },
        },
      })

      const result = resolveReference("$phases.classify-issue.result", ctx)
      expect(result).toEqual({ task_type: "bug", instructions: "Fix it." })
    })

    it("resolves $phases.NAME.result.FIELD to a specific field", () => {
      const ctx = makeContext({
        phases: {
          "classify-issue": {
            success: true,
            data: { task_type: "feature" },
            warnings: [],
          },
        },
      })

      expect(
        resolveReference("$phases.classify-issue.result.task_type", ctx),
      ).toBe("feature")
    })

    it("throws when phase does not exist", () => {
      const ctx = makeContext({ phases: {} })
      expect(() =>
        resolveReference("$phases.missing-phase.result", ctx),
      ).toThrow('no result found for phase "missing-phase"')
    })

    it("throws when accessing non-existent field in phase result", () => {
      const ctx = makeContext({
        phases: {
          "my-phase": {
            success: true,
            data: { foo: "bar" },
            warnings: [],
          },
        },
      })
      expect(() =>
        resolveReference("$phases.my-phase.result.nonexistent", ctx),
      ).toThrow("resolved to undefined")
    })

    it("throws for malformed phase reference (missing result)", () => {
      const ctx = makeContext()
      expect(() => resolveReference("$phases.foo", ctx)).toThrow(
        "expected $phases.<name>.result",
      )
    })

    it("throws for wrong accessor (not 'result')", () => {
      const ctx = makeContext()
      expect(() =>
        resolveReference("$phases.foo.output", ctx),
      ).toThrow('expected "result" after phase name')
    })
  })

  describe("$build.phases", () => {
    it("resolves $build.phases.NAME.result to build phase data", () => {
      const ctx = makeContext({
        build: {
          phases: {
            "setup-workspace": {
              success: true,
              data: { workspace_path: "/tmp/ws" },
              warnings: [],
            },
          },
        },
      })

      expect(
        resolveReference("$build.phases.setup-workspace.result", ctx),
      ).toEqual({ workspace_path: "/tmp/ws" })
    })

    it("resolves $build.phases.NAME.result.FIELD to a specific field", () => {
      const ctx = makeContext({
        build: {
          phases: {
            "execute-plan": {
              success: true,
              data: { diff_summary: "3 files changed", branch: "agent/issue-42" },
              warnings: [],
            },
          },
        },
      })

      expect(
        resolveReference(
          "$build.phases.execute-plan.result.diff_summary",
          ctx,
        ),
      ).toBe("3 files changed")
    })

    it("throws when build context is not available", () => {
      const ctx = makeContext({ build: undefined })
      expect(() =>
        resolveReference("$build.phases.foo.result", ctx),
      ).toThrow("no build context available")
    })

    it("throws when build phase does not exist", () => {
      const ctx = makeContext({ build: { phases: {} } })
      expect(() =>
        resolveReference("$build.phases.missing.result", ctx),
      ).toThrow('no result found for build phase "missing"')
    })

    it("throws for malformed build reference", () => {
      const ctx = makeContext()
      expect(() => resolveReference("$build.foo", ctx)).toThrow(
        "expected $build.phases.<name>.result",
      )
    })
  })

  describe("unknown root", () => {
    it("throws for unknown reference root", () => {
      const ctx = makeContext()
      expect(() => resolveReference("$unknown", ctx)).toThrow(
        'unknown root "$unknown"',
      )
    })

    it("throws for unknown reference root with path", () => {
      const ctx = makeContext()
      expect(() => resolveReference("$foo.bar.baz", ctx)).toThrow(
        'unknown root "$foo"',
      )
    })
  })
})

describe("resolveInputs", () => {
  it("resolves all inputs in a map", () => {
    const ctx = makeContext({
      phases: {
        "classify-issue": {
          success: true,
          data: { task_type: "bug" },
          warnings: [],
        },
      },
    })

    const inputs = {
      issue_context: "$issue",
      harness: "$config.execution.harness",
      task_type: "$phases.classify-issue.result.task_type",
      literal: "just a string",
    }

    const resolved = resolveInputs(inputs, ctx)

    expect(resolved.issue_context).toBe(ctx.issue)
    expect(resolved.harness).toBe("opencode")
    expect(resolved.task_type).toBe("bug")
    expect(resolved.literal).toBe("just a string")
  })

  it("returns empty object for undefined inputs", () => {
    const ctx = makeContext()
    expect(resolveInputs(undefined, ctx)).toEqual({})
  })

  it("returns empty object for empty inputs", () => {
    const ctx = makeContext()
    expect(resolveInputs({}, ctx)).toEqual({})
  })

  it("propagates resolution errors", () => {
    const ctx = makeContext()
    const inputs = { bad: "$nonexistent.path" }

    expect(() => resolveInputs(inputs, ctx)).toThrow()
  })
})
