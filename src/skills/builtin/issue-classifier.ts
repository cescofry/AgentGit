import { Skill, SkillInput, SkillResult, ExecutionContext } from "../interface"

const KEYWORD_MAP: Record<string, string[]> = {
  bug: ["bug", "fix", "error", "broken", "crash"],
  feature: ["feature", "add", "implement", "new"],
  docs: ["doc", "documentation", "readme", "docs"],
  ui: ["ui", "component", "design", "layout", "css"],
}

const INSTRUCTIONS: Record<string, string> = {
  bug: "Fix the reported bug. Identify root cause, implement fix, add regression tests.",
  feature: "Implement the requested feature. Follow existing code patterns, add tests.",
  docs: "Update documentation as requested. Ensure accuracy and completeness.",
  ui: "Implement the UI changes as described. Match existing styling patterns.",
}

const DEFAULT_TASK_TYPE = "feature"

/**
 * Classify an issue into a task type based on its labels and content.
 *
 * Classification priority:
 * 1. Label match against configured task_types
 * 2. Keyword heuristics from title and body
 * 3. Default to "feature"
 */
export class IssueClassifierSkill implements Skill {
  name = "issue-classifier"
  description = "Determine the issue type (bug, feature, docs, ui) from labels and content."

  async execute(input: SkillInput, context: ExecutionContext): Promise<SkillResult> {
    const issueContext = input.issue_context ?? context.issueContext
    const taskTypes: Record<string, { labels: string[] }> =
      input.task_types ?? context.repoConfig.task_types

    const warnings: string[] = []

    // 1. Check issue labels against task_types mapping (first match wins)
    const taskType = this.classifyByLabels(issueContext.labels, taskTypes)
      ?? this.classifyByKeywords(issueContext.issueTitle, issueContext.issueBody)
      ?? DEFAULT_TASK_TYPE

    if (taskType === DEFAULT_TASK_TYPE && !this.classifyByLabels(issueContext.labels, taskTypes) && !this.classifyByKeywords(issueContext.issueTitle, issueContext.issueBody)) {
      warnings.push(`No matching label or keyword found; defaulting to "${DEFAULT_TASK_TYPE}"`)
    }

    const instructions = INSTRUCTIONS[taskType] ?? INSTRUCTIONS[DEFAULT_TASK_TYPE]

    context.logger.info("Issue classified", { taskType, issueNumber: issueContext.issueNumber })

    return {
      success: true,
      data: {
        task_type: taskType,
        instructions,
      },
      warnings,
    }
  }

  /**
   * Match issue labels against configured task_types. First match wins.
   */
  private classifyByLabels(
    issueLabels: string[],
    taskTypes: Record<string, { labels: string[] }>,
  ): string | null {
    const lowerLabels = issueLabels.map((l) => l.toLowerCase())

    for (const [taskType, config] of Object.entries(taskTypes)) {
      for (const configLabel of config.labels) {
        if (lowerLabels.includes(configLabel.toLowerCase())) {
          return taskType
        }
      }
    }

    return null
  }

  /**
   * Infer task type from keywords in title and body.
   */
  private classifyByKeywords(title: string, body: string): string | null {
    const text = `${title} ${body}`.toLowerCase()

    for (const [taskType, keywords] of Object.entries(KEYWORD_MAP)) {
      for (const keyword of keywords) {
        // Match whole words only using word boundary
        const pattern = new RegExp(`\\b${keyword}\\b`, "i")
        if (pattern.test(text)) {
          return taskType
        }
      }
    }

    return null
  }
}
