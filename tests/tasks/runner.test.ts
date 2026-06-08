import { describe, it, expect, vi } from "vitest"
import { runTask, TaskResult } from "../../src/tasks/runner"
import { TaskDefinition } from "../../src/tasks/loader"
import { SkillRegistry } from "../../src/skills/registry"
import { Skill, SkillInput, SkillResult, ExecutionContext } from "../../src/skills/interface"
import { ResolutionContext } from "../../src/tasks/resolver"
import { IssueContext } from "../../src/harness/interface"
import { DEFAULT_CONFIG } from "../../src/config/defaults"
import { createLogger } from "../../src/utils/logger"

// ── Helpers ──

function makeIssueContext(): IssueContext {
  return {
    issueNumber: 42,
    issueTitle: "Fix bug",
    issueBody: "Bug description.",
    comments: [],
    labels: ["bug"],
    repoUrl: "https://github.com/acme/app",
    repoOwner: "acme",
    repoName: "app",
  }
}

function makeExecutionContext(): ExecutionContext {
  return {
    issueContext: makeIssueContext(),
    repoConfig: { ...DEFAULT_CONFIG },
    logger: createLogger("warn"),
    harness: {
      name: "mock",
      async proposePlan() {
        return { plan: "", planVersion: 1, confidence: 0, warnings: [] }
      },
      async revisePlan() {
        return { plan: "", planVersion: 1, confidence: 0, warnings: [] }
      },
      async executePlan() {
        return { success: true, branch: "", diffSummary: "", errors: [] }
      },
    },
    workspacePath: "/tmp/test-workspace",
    signingSecret: "test-secret",
  }
}

function makeResolutionContext(): ResolutionContext {
  return {
    issue: makeIssueContext(),
    config: { ...DEFAULT_CONFIG },
    plan: "test plan",
    phases: {},
  }
}

function makeSkill(
  name: string,
  result: SkillResult,
): Skill {
  return {
    name,
    description: `Mock ${name}`,
    async execute(_input: SkillInput, _context: ExecutionContext): Promise<SkillResult> {
      return result
    },
  }
}

function makeFailingSkill(name: string, error: string): Skill {
  return makeSkill(name, {
    success: false,
    data: {},
    warnings: [],
    error,
  })
}

function makeSuccessSkill(name: string, data: Record<string, any> = {}): Skill {
  return makeSkill(name, {
    success: true,
    data,
    warnings: [],
  })
}

function makeThrowingSkill(name: string, errorMsg: string): Skill {
  return {
    name,
    description: `Throwing ${name}`,
    async execute(): Promise<SkillResult> {
      throw new Error(errorMsg)
    },
  }
}

// ── Tests ──

describe("runTask", () => {
  describe("successful execution", () => {
    it("runs all phases and returns success", async () => {
      const registry = new SkillRegistry()
      registry.register(makeSuccessSkill("step-a", { result_a: true }))
      registry.register(makeSuccessSkill("step-b", { result_b: true }))

      const task: TaskDefinition = {
        name: "test-task",
        phases: [
          { name: "phase-a", skill: "step-a" },
          { name: "phase-b", skill: "step-b" },
        ],
      }

      const result = await runTask(task, {
        skillRegistry: registry,
        executionContext: makeExecutionContext(),
        resolutionContext: makeResolutionContext(),
      })

      expect(result.success).toBe(true)
      expect(result.taskName).toBe("test-task")
      expect(result.phaseResults["phase-a"].success).toBe(true)
      expect(result.phaseResults["phase-b"].success).toBe(true)
      expect(result.failedPhase).toBeUndefined()
    })

    it("makes prior phase results available to later phases via resolution context", async () => {
      const registry = new SkillRegistry()
      registry.register(
        makeSuccessSkill("classifier", { task_type: "bug" }),
      )

      // Second skill checks that it receives the resolved input
      let receivedInput: SkillInput = {}
      const planGenerator: Skill = {
        name: "planner",
        description: "Plan generator",
        async execute(input: SkillInput): Promise<SkillResult> {
          receivedInput = input
          return { success: true, data: { plan: "done" }, warnings: [] }
        },
      }
      registry.register(planGenerator)

      const task: TaskDefinition = {
        name: "plan",
        phases: [
          {
            name: "classify",
            skill: "classifier",
          },
          {
            name: "generate",
            skill: "planner",
            inputs: {
              task_type: "$phases.classify.result.task_type",
            },
          },
        ],
      }

      const result = await runTask(task, {
        skillRegistry: registry,
        executionContext: makeExecutionContext(),
        resolutionContext: makeResolutionContext(),
      })

      expect(result.success).toBe(true)
      expect(receivedInput.task_type).toBe("bug")
    })
  })

  describe("on_failure: block", () => {
    it("stops execution and returns failure", async () => {
      const registry = new SkillRegistry()
      registry.register(makeFailingSkill("blocker", "blocked error"))
      registry.register(makeSuccessSkill("after-blocker"))

      const task: TaskDefinition = {
        name: "test-task",
        phases: [
          { name: "phase-block", skill: "blocker", on_failure: "block" },
          { name: "phase-after", skill: "after-blocker" },
        ],
      }

      const result = await runTask(task, {
        skillRegistry: registry,
        executionContext: makeExecutionContext(),
        resolutionContext: makeResolutionContext(),
      })

      expect(result.success).toBe(false)
      expect(result.failedPhase).toBe("phase-block")
      expect(result.failureAction).toBe("block")
      expect(result.error).toContain("blocked error")
      // The second phase should not have been executed
      expect(result.phaseResults["phase-after"]).toBeUndefined()
    })

    it("defaults to block when on_failure is not specified", async () => {
      const registry = new SkillRegistry()
      registry.register(makeFailingSkill("fail-skill", "default block"))

      const task: TaskDefinition = {
        name: "test-task",
        phases: [
          { name: "phase-default", skill: "fail-skill" },
        ],
      }

      const result = await runTask(task, {
        skillRegistry: registry,
        executionContext: makeExecutionContext(),
        resolutionContext: makeResolutionContext(),
      })

      expect(result.success).toBe(false)
      expect(result.failureAction).toBe("block")
    })
  })

  describe("on_failure: lock-security", () => {
    it("stops execution and returns lock-security action", async () => {
      const registry = new SkillRegistry()
      registry.register(makeFailingSkill("safety-check", "unsafe content"))

      const task: TaskDefinition = {
        name: "pre-plan",
        phases: [
          {
            name: "safety-review",
            skill: "safety-check",
            on_failure: "lock-security",
          },
        ],
      }

      const result = await runTask(task, {
        skillRegistry: registry,
        executionContext: makeExecutionContext(),
        resolutionContext: makeResolutionContext(),
      })

      expect(result.success).toBe(false)
      expect(result.failedPhase).toBe("safety-review")
      expect(result.failureAction).toBe("lock-security")
    })
  })

  describe("on_failure: warn", () => {
    it("continues execution after a warning failure", async () => {
      const registry = new SkillRegistry()
      registry.register(makeFailingSkill("warn-skill", "non-critical issue"))
      registry.register(makeSuccessSkill("continue-skill", { ok: true }))

      const task: TaskDefinition = {
        name: "test-task",
        phases: [
          {
            name: "phase-warn",
            skill: "warn-skill",
            on_failure: "warn",
          },
          {
            name: "phase-continue",
            skill: "continue-skill",
          },
        ],
      }

      const result = await runTask(task, {
        skillRegistry: registry,
        executionContext: makeExecutionContext(),
        resolutionContext: makeResolutionContext(),
      })

      expect(result.success).toBe(true)
      expect(result.phaseResults["phase-warn"].success).toBe(false)
      expect(result.phaseResults["phase-continue"].success).toBe(true)
    })
  })

  describe("on_failure: skip", () => {
    it("silently skips and continues execution", async () => {
      const registry = new SkillRegistry()
      registry.register(makeFailingSkill("skip-skill", "skippable error"))
      registry.register(makeSuccessSkill("next-skill", { done: true }))

      const task: TaskDefinition = {
        name: "test-task",
        phases: [
          {
            name: "phase-skip",
            skill: "skip-skill",
            on_failure: "skip",
          },
          {
            name: "phase-next",
            skill: "next-skill",
          },
        ],
      }

      const result = await runTask(task, {
        skillRegistry: registry,
        executionContext: makeExecutionContext(),
        resolutionContext: makeResolutionContext(),
      })

      expect(result.success).toBe(true)
      expect(result.phaseResults["phase-skip"].success).toBe(false)
      expect(result.phaseResults["phase-next"].success).toBe(true)
    })
  })

  describe("required phase", () => {
    it("causes task failure even with on_failure: warn", async () => {
      const registry = new SkillRegistry()
      registry.register(makeFailingSkill("required-warn", "required failed"))
      registry.register(makeSuccessSkill("unreachable"))

      const task: TaskDefinition = {
        name: "test-task",
        phases: [
          {
            name: "phase-required",
            skill: "required-warn",
            on_failure: "warn",
            required: true,
          },
          {
            name: "phase-unreachable",
            skill: "unreachable",
          },
        ],
      }

      const result = await runTask(task, {
        skillRegistry: registry,
        executionContext: makeExecutionContext(),
        resolutionContext: makeResolutionContext(),
      })

      expect(result.success).toBe(false)
      expect(result.failedPhase).toBe("phase-required")
      expect(result.failureAction).toBe("warn")
    })

    it("causes task failure even with on_failure: skip", async () => {
      const registry = new SkillRegistry()
      registry.register(makeFailingSkill("required-skip", "required skip failed"))

      const task: TaskDefinition = {
        name: "test-task",
        phases: [
          {
            name: "phase-required-skip",
            skill: "required-skip",
            on_failure: "skip",
            required: true,
          },
        ],
      }

      const result = await runTask(task, {
        skillRegistry: registry,
        executionContext: makeExecutionContext(),
        resolutionContext: makeResolutionContext(),
      })

      expect(result.success).toBe(false)
      expect(result.failedPhase).toBe("phase-required-skip")
      expect(result.failureAction).toBe("skip")
    })
  })

  describe("missing skill", () => {
    it("produces an error result when skill is not found", async () => {
      const registry = new SkillRegistry()
      // Don't register any skills

      const task: TaskDefinition = {
        name: "test-task",
        phases: [
          { name: "phase-missing", skill: "nonexistent-skill" },
        ],
      }

      const result = await runTask(task, {
        skillRegistry: registry,
        executionContext: makeExecutionContext(),
        resolutionContext: makeResolutionContext(),
      })

      expect(result.success).toBe(false)
      expect(result.failedPhase).toBe("phase-missing")
      expect(result.failureAction).toBe("block")
      expect(result.error).toContain('"nonexistent-skill" not found')
    })
  })

  describe("skill throwing exceptions", () => {
    it("catches exceptions and returns failure", async () => {
      const registry = new SkillRegistry()
      registry.register(makeThrowingSkill("crasher", "boom!"))

      const task: TaskDefinition = {
        name: "test-task",
        phases: [
          { name: "phase-crash", skill: "crasher" },
        ],
      }

      const result = await runTask(task, {
        skillRegistry: registry,
        executionContext: makeExecutionContext(),
        resolutionContext: makeResolutionContext(),
      })

      expect(result.success).toBe(false)
      expect(result.failedPhase).toBe("phase-crash")
      expect(result.error).toContain("boom!")
    })
  })

  describe("empty task", () => {
    it("succeeds with no phases", async () => {
      const registry = new SkillRegistry()

      const task: TaskDefinition = {
        name: "empty-task",
        phases: [],
      }

      const result = await runTask(task, {
        skillRegistry: registry,
        executionContext: makeExecutionContext(),
        resolutionContext: makeResolutionContext(),
      })

      expect(result.success).toBe(true)
      expect(result.taskName).toBe("empty-task")
      expect(Object.keys(result.phaseResults)).toHaveLength(0)
    })
  })

  describe("input resolution errors", () => {
    it("fails when input reference cannot be resolved", async () => {
      const registry = new SkillRegistry()
      registry.register(makeSuccessSkill("some-skill"))

      const task: TaskDefinition = {
        name: "test-task",
        phases: [
          {
            name: "phase-bad-input",
            skill: "some-skill",
            inputs: {
              bad_ref: "$nonexistent.path",
            },
          },
        ],
      }

      const result = await runTask(task, {
        skillRegistry: registry,
        executionContext: makeExecutionContext(),
        resolutionContext: makeResolutionContext(),
      })

      expect(result.success).toBe(false)
      expect(result.failedPhase).toBe("phase-bad-input")
      expect(result.error).toContain("Input resolution failed")
    })
  })
})
