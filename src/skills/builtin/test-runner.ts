import * as fs from "fs"
import * as path from "path"
import { execSync } from "child_process"
import { Skill, SkillInput, SkillResult, ExecutionContext } from "../interface"

export class TestRunnerSkill implements Skill {
  name = "test-runner"
  description = "Run the project test suite against the agent's changes."

  async execute(input: SkillInput, context: ExecutionContext): Promise<SkillResult> {
    const workspace = input.workspace as string
    const testCommand = (input.test_command as string) || "auto"

    if (!workspace) {
      return {
        success: false,
        data: {},
        warnings: [],
        error: "Missing required input: workspace",
      }
    }

    let command: string | null = null
    const warnings: string[] = []

    if (testCommand === "auto") {
      command = detectTestCommand(workspace)
      if (!command) {
        context.logger.warn("No test command detected", { workspace })
        return {
          success: true,
          data: {
            test_output: "",
            test_command: null,
            auto_detected: true,
          },
          warnings: ["No test command detected. Skipping tests."],
        }
      }
      context.logger.info("Auto-detected test command", { command })
    } else {
      command = testCommand
    }

    try {
      context.logger.info("Running tests", { command, workspace })

      const output = execSync(command, {
        cwd: workspace,
        stdio: "pipe",
        timeout: context.repoConfig.execution.max_runtime_minutes * 60 * 1000,
        encoding: "utf-8",
      })

      return {
        success: true,
        data: {
          test_output: output,
          test_command: command,
          auto_detected: testCommand === "auto",
        },
        warnings,
      }
    } catch (err: any) {
      const output = (err.stdout || "") + (err.stderr || "")
      return {
        success: false,
        data: {
          test_output: output,
          test_command: command,
          exit_code: err.status,
          auto_detected: testCommand === "auto",
        },
        warnings,
        error: `Tests failed with exit code ${err.status}`,
      }
    }
  }
}

/**
 * Detect the appropriate test command for a workspace.
 * Returns null if no test framework is detected.
 */
export function detectTestCommand(workspace: string): string | null {
  // Check for package.json with test script
  const pkgPath = path.join(workspace, "package.json")
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"))
      if (pkg.scripts?.test && pkg.scripts.test !== 'echo "Error: no test specified" && exit 1') {
        return "npm test"
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Check for Makefile with test target
  const makefilePath = path.join(workspace, "Makefile")
  if (fs.existsSync(makefilePath)) {
    const content = fs.readFileSync(makefilePath, "utf-8")
    if (/^test\s*:/m.test(content)) {
      return "make test"
    }
  }

  // Check for Python test frameworks
  const setupPyPath = path.join(workspace, "setup.py")
  const pyprojectPath = path.join(workspace, "pyproject.toml")
  if (fs.existsSync(setupPyPath) || fs.existsSync(pyprojectPath)) {
    return "python -m pytest"
  }

  // Check for Go modules
  const goModPath = path.join(workspace, "go.mod")
  if (fs.existsSync(goModPath)) {
    return "go test ./..."
  }

  return null
}
