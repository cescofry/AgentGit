import * as fs from "fs"
import * as path from "path"
import { execSync } from "child_process"
import { Skill, SkillInput, SkillResult, ExecutionContext } from "../interface"

export class LintRunnerSkill implements Skill {
  name = "lint-runner"
  description = "Run linting and formatting checks."

  async execute(input: SkillInput, context: ExecutionContext): Promise<SkillResult> {
    const workspace = input.workspace as string

    if (!workspace) {
      return {
        success: false,
        data: {},
        warnings: [],
        error: "Missing required input: workspace",
      }
    }

    const command = detectLintCommand(workspace)

    if (!command) {
      context.logger.warn("No linter detected", { workspace })
      return {
        success: true,
        data: {
          lint_output: "",
          lint_command: null,
        },
        warnings: ["No linting configuration detected. Skipping lint."],
      }
    }

    try {
      context.logger.info("Running linter", { command, workspace })

      const output = execSync(command, {
        cwd: workspace,
        stdio: "pipe",
        timeout: 5 * 60 * 1000, // 5 minutes
        encoding: "utf-8",
      })

      return {
        success: true,
        data: {
          lint_output: output,
          lint_command: command,
        },
        warnings: [],
      }
    } catch (err: any) {
      const output = (err.stdout || "") + (err.stderr || "")
      return {
        success: false,
        data: {
          lint_output: output,
          lint_command: command,
          exit_code: err.status,
        },
        warnings: [],
        error: `Linting failed with exit code ${err.status}`,
      }
    }
  }
}

/**
 * Detect the appropriate lint command for a workspace.
 * Returns null if no linting tool is detected.
 */
export function detectLintCommand(workspace: string): string | null {
  // Check for package.json with lint script
  const pkgPath = path.join(workspace, "package.json")
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"))
      if (pkg.scripts?.lint) {
        return "npm run lint"
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Check for ESLint config files
  const eslintConfigs = [
    ".eslintrc",
    ".eslintrc.js",
    ".eslintrc.cjs",
    ".eslintrc.json",
    ".eslintrc.yml",
    ".eslintrc.yaml",
  ]

  for (const config of eslintConfigs) {
    if (fs.existsSync(path.join(workspace, config))) {
      return "npx eslint ."
    }
  }

  return null
}
