import { describe, it, expect, beforeEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as yaml from "js-yaml"
import { loadDefaultTasks, loadTaskDefinition } from "../../src/tasks/loader"

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

describe("loadDefaultTasks", () => {
  describe("default tasks load correctly", () => {
    it("loads all 4 default tasks", () => {
      const tasks = loadDefaultTasks()

      expect(Object.keys(tasks)).toHaveLength(4)
      expect(tasks).toHaveProperty("pre-plan")
      expect(tasks).toHaveProperty("plan")
      expect(tasks).toHaveProperty("build")
      expect(tasks).toHaveProperty("post-build")
    })

    it("each task has a name and description", () => {
      const tasks = loadDefaultTasks()

      for (const [key, task] of Object.entries(tasks)) {
        expect(task.name).toBe(key)
        expect(typeof task.description).toBe("string")
        expect(task.description.length).toBeGreaterThan(0)
      }
    })

    it("each task has a non-empty phases array", () => {
      const tasks = loadDefaultTasks()

      for (const task of Object.values(tasks)) {
        expect(task.phases.length).toBeGreaterThan(0)
      }
    })
  })

  describe("all 4 default tasks have expected phases", () => {
    it("pre-plan has safety-review phase", () => {
      const tasks = loadDefaultTasks()
      const prePlan = tasks["pre-plan"]

      expect(prePlan.phases).toHaveLength(1)
      expect(prePlan.phases[0].name).toBe("safety-review")
      expect(prePlan.phases[0].skill).toBe("task-safety-checker")
      expect(prePlan.phases[0].on_failure).toBe("lock-security")
      expect(prePlan.phases[0].required).toBe(true)
    })

    it("plan has classify-issue and generate-plan phases", () => {
      const tasks = loadDefaultTasks()
      const plan = tasks["plan"]

      expect(plan.phases).toHaveLength(2)
      expect(plan.phases[0].name).toBe("classify-issue")
      expect(plan.phases[0].skill).toBe("issue-classifier")
      expect(plan.phases[1].name).toBe("generate-plan")
      expect(plan.phases[1].skill).toBe("plan-generator")
      expect(plan.phases[1].on_failure).toBe("block")
    })

    it("build has setup-workspace and execute-plan phases", () => {
      const tasks = loadDefaultTasks()
      const build = tasks["build"]

      expect(build.phases).toHaveLength(2)
      expect(build.phases[0].name).toBe("setup-workspace")
      expect(build.phases[0].skill).toBe("workspace-setup")
      expect(build.phases[1].name).toBe("execute-plan")
      expect(build.phases[1].skill).toBe("plan-executor")
    })

    it("post-build has run-tests, check-docs, lint-check, and create-pr phases", () => {
      const tasks = loadDefaultTasks()
      const postBuild = tasks["post-build"]

      expect(postBuild.phases).toHaveLength(4)
      expect(postBuild.phases[0].name).toBe("run-tests")
      expect(postBuild.phases[0].skill).toBe("test-runner")
      expect(postBuild.phases[0].on_failure).toBe("block")
      expect(postBuild.phases[0].required).toBe(true)

      expect(postBuild.phases[1].name).toBe("check-docs")
      expect(postBuild.phases[1].skill).toBe("docs-checker")
      expect(postBuild.phases[1].on_failure).toBe("warn")
      expect(postBuild.phases[1].required).toBe(false)

      expect(postBuild.phases[2].name).toBe("lint-check")
      expect(postBuild.phases[2].skill).toBe("lint-runner")
      expect(postBuild.phases[2].on_failure).toBe("warn")
      expect(postBuild.phases[2].required).toBe(false)

      expect(postBuild.phases[3].name).toBe("create-pr")
      expect(postBuild.phases[3].skill).toBe("pr-creator")
      expect(postBuild.phases[3].required).toBe(true)
    })

    it("phases have $-prefixed input references", () => {
      const tasks = loadDefaultTasks()

      // pre-plan safety-review inputs
      const safetyInputs = tasks["pre-plan"].phases[0].inputs
      expect(safetyInputs).toBeDefined()
      expect(safetyInputs!.issue_context).toBe("$issue")
      expect(safetyInputs!.disallowed_categories).toBe(
        "$config.security.disallowed_categories",
      )

      // plan classify-issue inputs
      const classifyInputs = tasks["plan"].phases[0].inputs
      expect(classifyInputs).toBeDefined()
      expect(classifyInputs!.issue_context).toBe("$issue")
      expect(classifyInputs!.task_types).toBe("$config.task_types")

      // plan generate-plan inputs reference prior phase results
      const genInputs = tasks["plan"].phases[1].inputs
      expect(genInputs).toBeDefined()
      expect(genInputs!.task_type).toBe("$phases.classify-issue.result.task_type")
    })
  })
})

describe("loadTaskDefinition", () => {
  describe("user override replaces built-in task", () => {
    it("loads user override from GitHub when available", async () => {
      const userTask = yaml.dump({
        name: "pre-plan",
        description: "Custom pre-plan with extra validation.",
        phases: [
          {
            name: "custom-check",
            skill: "custom-checker",
            description: "Run custom validation.",
            required: true,
          },
          {
            name: "safety-review",
            skill: "task-safety-checker",
            on_failure: "lock-security",
            required: true,
          },
        ],
      })

      const octokit = mockOctokit({
        ".agentGit/tasks/pre-plan.yml": userTask,
      })

      const task = await loadTaskDefinition("pre-plan", octokit, "owner", "repo")

      expect(task).not.toBeNull()
      expect(task!.description).toBe("Custom pre-plan with extra validation.")
      expect(task!.phases).toHaveLength(2)
      expect(task!.phases[0].name).toBe("custom-check")
      expect(task!.phases[0].skill).toBe("custom-checker")
    })

    it("falls back to built-in default when no user override exists", async () => {
      const octokit = mockOctokit({})

      const task = await loadTaskDefinition("pre-plan", octokit, "owner", "repo")

      expect(task).not.toBeNull()
      expect(task!.name).toBe("pre-plan")
      expect(task!.phases).toHaveLength(1)
      expect(task!.phases[0].skill).toBe("task-safety-checker")
    })

    it("returns null for a task that does not exist anywhere", async () => {
      const octokit = mockOctokit({})

      const task = await loadTaskDefinition(
        "nonexistent-task",
        octokit,
        "owner",
        "repo",
      )

      expect(task).toBeNull()
    })

    it("falls back to built-in when user override is invalid YAML", async () => {
      const octokit = mockOctokit({
        ".agentGit/tasks/plan.yml": ":::invalid yaml{{{",
      })

      const task = await loadTaskDefinition("plan", octokit, "owner", "repo")

      // Should fall back to built-in since user YAML is invalid
      expect(task).not.toBeNull()
      expect(task!.name).toBe("plan")
      expect(task!.phases).toHaveLength(2)
    })

    it("loads user override from local filesystem", async () => {
      // Use a temp directory to simulate local loading
      const tmpDir = path.join("/var/folders/qs/c9f_8hmx5xgb3_hd59lq1vs80000gq/T/opencode", "task-loader-test")
      const tasksDir = path.join(tmpDir, ".agentGit", "tasks")

      try {
        fs.mkdirSync(tasksDir, { recursive: true })
        fs.writeFileSync(
          path.join(tasksDir, "build.yml"),
          yaml.dump({
            name: "build",
            description: "Custom build task.",
            phases: [
              {
                name: "custom-setup",
                skill: "custom-workspace-setup",
                required: true,
              },
            ],
          }),
        )

        const task = await loadTaskDefinition(
          "build",
          null,
          "owner",
          "repo",
          undefined,
          tmpDir,
        )

        expect(task).not.toBeNull()
        expect(task!.description).toBe("Custom build task.")
        expect(task!.phases).toHaveLength(1)
        expect(task!.phases[0].skill).toBe("custom-workspace-setup")
      } finally {
        // Cleanup
        fs.rmSync(tmpDir, { recursive: true, force: true })
      }
    })
  })
})
