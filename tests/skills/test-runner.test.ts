import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { TestRunnerSkill, detectTestCommand } from "../../src/skills/builtin/test-runner"
import { ExecutionContext, SkillInput } from "../../src/skills/interface"
import { createLogger } from "../../src/utils/logger"
import { DEFAULT_CONFIG } from "../../src/config/defaults"

// Mock child_process for test execution
vi.mock("child_process", () => ({
  execSync: vi.fn(),
}))

import { execSync } from "child_process"

describe("TestRunnerSkill", () => {
  let skill: TestRunnerSkill
  let context: ExecutionContext

  beforeEach(() => {
    vi.clearAllMocks()

    skill = new TestRunnerSkill()

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
    expect(skill.name).toBe("test-runner")
    expect(skill.description).toContain("test suite")
  })

  it("runs explicit test command", async () => {
    const mockedExecSync = vi.mocked(execSync)
    mockedExecSync.mockReturnValue("All 5 tests passed" as any)

    const input: SkillInput = {
      workspace: "/tmp/workspace",
      test_command: "npm run test:unit",
    }

    const result = await skill.execute(input, context)

    expect(result.success).toBe(true)
    expect(result.data.test_command).toBe("npm run test:unit")
    expect(result.data.test_output).toBe("All 5 tests passed")
    expect(result.data.auto_detected).toBe(false)
    expect(mockedExecSync).toHaveBeenCalledWith(
      "npm run test:unit",
      expect.objectContaining({ cwd: "/tmp/workspace" }),
    )
  })

  it("returns error when workspace is missing", async () => {
    const result = await skill.execute({ test_command: "npm test" }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain("Missing required input: workspace")
  })

  it("handles test failure", async () => {
    const mockedExecSync = vi.mocked(execSync)
    const err = new Error("tests failed") as any
    err.status = 1
    err.stdout = "FAIL: 2 tests failed"
    err.stderr = ""
    mockedExecSync.mockImplementation(() => { throw err })

    const input: SkillInput = {
      workspace: "/tmp/workspace",
      test_command: "npm test",
    }

    const result = await skill.execute(input, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain("exit code 1")
    expect(result.data.test_output).toContain("FAIL")
    expect(result.data.exit_code).toBe(1)
  })
})

describe("detectTestCommand", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-detect-"))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("detects npm test from package.json", () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        scripts: { test: "vitest run" },
      }),
    )

    expect(detectTestCommand(tmpDir)).toBe("npm test")
  })

  it("skips default npm test script", () => {
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({
        scripts: { test: 'echo "Error: no test specified" && exit 1' },
      }),
    )

    expect(detectTestCommand(tmpDir)).toBeNull()
  })

  it("detects make test from Makefile", () => {
    fs.writeFileSync(path.join(tmpDir, "Makefile"), "test:\n\techo running tests\n")

    expect(detectTestCommand(tmpDir)).toBe("make test")
  })

  it("detects pytest from setup.py", () => {
    fs.writeFileSync(path.join(tmpDir, "setup.py"), "from setuptools import setup\n")

    expect(detectTestCommand(tmpDir)).toBe("python -m pytest")
  })

  it("detects pytest from pyproject.toml", () => {
    fs.writeFileSync(path.join(tmpDir, "pyproject.toml"), "[tool.pytest]\n")

    expect(detectTestCommand(tmpDir)).toBe("python -m pytest")
  })

  it("detects go test from go.mod", () => {
    fs.writeFileSync(path.join(tmpDir, "go.mod"), "module example.com/test\n")

    expect(detectTestCommand(tmpDir)).toBe("go test ./...")
  })

  it("returns null when no test framework is found", () => {
    expect(detectTestCommand(tmpDir)).toBeNull()
  })
})
