import * as fs from "fs"
import * as path from "path"
import { Skill, SkillInput, SkillResult, ExecutionContext } from "../interface"

export class DocsCheckerSkill implements Skill {
  name = "docs-checker"
  description = "Verify that documentation is updated for any new public APIs or behavior changes."

  async execute(input: SkillInput, context: ExecutionContext): Promise<SkillResult> {
    const workspace = input.workspace as string
    const diffSummary = (input.diff_summary as string) || ""

    if (!workspace) {
      return {
        success: false,
        data: {},
        warnings: [],
        error: "Missing required input: workspace",
      }
    }

    const warnings: string[] = []
    const data: Record<string, any> = {
      docs_checked: true,
    }

    // Check if source files were modified
    const sourceChanged = hasSourceChanges(diffSummary)

    // Check if docs were modified
    const docsChanged = hasDocsChanges(diffSummary)

    // Check if README exists in workspace
    const readmeExists = fs.existsSync(path.join(workspace, "README.md")) ||
      fs.existsSync(path.join(workspace, "README"))

    // Check if docs/ directory exists
    const docsDir = path.join(workspace, "docs")
    const docsDirExists = fs.existsSync(docsDir) && fs.statSync(docsDir).isDirectory()

    data.source_changed = sourceChanged
    data.docs_changed = docsChanged
    data.readme_exists = readmeExists
    data.docs_dir_exists = docsDirExists

    if (sourceChanged && !docsChanged) {
      if (readmeExists || docsDirExists) {
        warnings.push(
          "Source files were modified but no documentation files were updated. " +
          "Consider updating README.md or docs/ if public APIs or behavior changed.",
        )
      }
    }

    // This skill is non-blocking -- always returns success
    return {
      success: true,
      data,
      warnings,
    }
  }
}

/**
 * Check if the diff summary indicates source file changes.
 * Looks for common source file extensions.
 */
function hasSourceChanges(diffSummary: string): boolean {
  if (!diffSummary) return false
  const sourcePatterns = /\.(ts|js|tsx|jsx|py|go|rs|java|rb|c|cpp|h|hpp|swift|kt)\b/i
  return sourcePatterns.test(diffSummary)
}

/**
 * Check if the diff summary indicates documentation changes.
 * Looks for README, docs/, *.md files.
 */
function hasDocsChanges(diffSummary: string): boolean {
  if (!diffSummary) return false
  const docsPatterns = /(README|CHANGELOG|docs\/|\.md\b)/i
  return docsPatterns.test(diffSummary)
}
