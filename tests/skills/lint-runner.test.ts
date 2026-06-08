import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { LintRunnerSkill, detectLintCommand } from "../../src/skills/builtin/lint-runner"
import { ExecutionContext, SkillInput } from "../../src/skills/interface"
import { createLogger } from "../../src/utils/logger"
import { DEFAULT_CONFIG } from "../../src/config/defaults"

// Mock child_process
vi.mock("child_process", () => ({
  execSync: vi.fn(),
}))

import { execSync } from "child_process"

describe("LintRunnerSkill", () => {
  let skill: LintRunnerSkill
  let context: ExecutionContext

  beforeEach(() => {
    vi.clearAllMocks()

    skill = new LintRunnerSkill()

    context = {
      issueContext: {
        issueNumber: 42,
        issueTitle: "Fix bug",
        issueBody: "",
        comments: [],
        labels: [],
        repoUrl: "https://github.com/owner/repo",
        repoOwner: "owner",
        repoName: "repo",
      },
      repoConfig: { ...DEFAULT_CONFIG },
      logger: createLogger("error"),
      harness: {
        name: "mock",
        proposePlan: vi.fn(),
        revisePlan: vi.fn(),
        executePlan: vi.fn(),
      },
      workspacePath: "/tmp/workspace",
      signingSecret: "test-secret",
    }
  })

  it("has correct name and description", () => {
    expect(skill.name).toBe("lint-runner")
    expect(skill.description).toContain("linting")
  })

  it("returns error when workspace is missing", async () => {
    const result = await skill.execute({}, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain("Missing required input: workspace")
  })

  it("handles lint failure", async () => {
    // Create a workspace with a lint script
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lint-test-"))
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { lint: "eslint ." } }),
    )

    const mockedExecSync = vi.mocked(execSync)
    const err = new Error("lint failed") as any
    err.status = 1
    err.stdout = "2 errors found"
    err.stderr = ""
    mockedExecSync.mockImplementation(() => { throw err })

    const input: SkillInput = { workspace: tmpDir }

    const result = await skill.execute(input, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain("exit code 1")
    expect(result.data.lint_output).toContain("2 errors")

    fs.rmSync(tmpDir, { recursive: true, force: true })
  })
})

describe("detectLintCommand", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lint-detect-"))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("detects npm run lint from package.json", () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { lint: "eslint src/" } }),
    )

    expect(detectLintCommand(tmpDir)).toBe("npm run lint")
  })

  it("detects eslint from .eslintrc.json", () => {
    fs.writeFileSync(path.join(tmpDir, ".eslintrc.json"), '{"rules": {}}')

    expect(detectLintCommand(tmpDir)).toBe("npx eslint .")
  })

  it("detects eslint from .eslintrc.js", () => {
    fs.writeFileSync(path.join(tmpDir, ".eslintrc.js"), "module.exports = {}")

    expect(detectLintCommand(tmpDir)).toBe("npx eslint .")
  })

  it("returns null when no linter is detected", () => {
    expect(detectLintCommand(tmpDir)).toBeNull()
  })

  it("prefers package.json lint script over eslintrc", () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ scripts: { lint: "eslint --fix ." } }),
    )
    fs.writeFileSync(path.join(tmpDir, ".eslintrc.json"), '{}')

    // package.json lint script takes priority
    expect(detectLintCommand(tmpDir)).toBe("npm run lint")
  })
})
