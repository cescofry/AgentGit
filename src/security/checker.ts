import {
  Skill,
  SkillInput,
  SkillResult,
  ExecutionContext,
} from "../skills/interface"
import { IssueContext } from "../harness/interface"
import { DisallowedCategory, ALL_DISALLOWED_CATEGORIES } from "./categories"
import { RuleMatch, checkRules } from "./rules"

export interface TaskSafetyResult {
  safe: boolean
  category?: DisallowedCategory
  reason: string
  confidence: number
  matches: RuleMatch[]
}

/**
 * Combine issue title, body, and all comment bodies into a single string for scanning.
 */
function buildScanText(issueContext: IssueContext): string {
  const parts: string[] = []

  if (issueContext.issueTitle) {
    parts.push(issueContext.issueTitle)
  }

  if (issueContext.issueBody) {
    parts.push(issueContext.issueBody)
  }

  if (issueContext.comments) {
    for (const comment of issueContext.comments) {
      if (comment.body) {
        parts.push(comment.body)
      }
    }
  }

  return parts.join("\n")
}

/**
 * Run the safety check against an IssueContext and return a TaskSafetyResult.
 */
export function checkIssueSafety(
  issueContext: IssueContext,
  disallowedCategories: DisallowedCategory[],
): TaskSafetyResult {
  const text = buildScanText(issueContext)

  if (text.trim().length === 0) {
    return {
      safe: true,
      reason: "No content to check.",
      confidence: 1.0,
      matches: [],
    }
  }

  const matches = checkRules(text, disallowedCategories)

  // Filter to matches with confidence >= 0.5
  const significantMatches = matches.filter((m) => m.confidence >= 0.5)

  if (significantMatches.length === 0) {
    return {
      safe: true,
      reason: "No disallowed patterns detected.",
      confidence: 1.0,
      matches: [],
    }
  }

  // Highest confidence match determines the result
  const top = significantMatches[0]

  return {
    safe: false,
    category: top.category,
    reason: `Detected disallowed pattern: ${top.pattern} (matched "${top.matchedText}")`,
    confidence: top.confidence,
    matches: significantMatches,
  }
}

export class TaskSafetyCheckerSkill implements Skill {
  name = "task-safety-checker"
  description =
    "Check issue content for malicious intent or disallowed task categories."

  async execute(
    input: SkillInput,
    _context: ExecutionContext,
  ): Promise<SkillResult> {
    const issueContext = input.issue_context as IssueContext | undefined
    if (!issueContext) {
      return {
        success: false,
        data: {},
        warnings: [],
        error: "Missing issue_context in skill input.",
      }
    }

    const rawCategories = input.disallowed_categories as string[] | undefined
    const disallowedCategories: DisallowedCategory[] = rawCategories
      ? (rawCategories.filter((c) =>
          ALL_DISALLOWED_CATEGORIES.includes(c as DisallowedCategory),
        ) as DisallowedCategory[])
      : ALL_DISALLOWED_CATEGORIES

    const result = checkIssueSafety(issueContext, disallowedCategories)

    if (!result.safe) {
      return {
        success: false,
        data: {
          safe: false,
          category: result.category,
          reason: result.reason,
          confidence: result.confidence,
          matches: result.matches,
        },
        warnings: [],
        error: `Issue flagged as unsafe: ${result.reason}`,
      }
    }

    return {
      success: true,
      data: {
        safe: true,
        reason: result.reason,
        confidence: result.confidence,
        matches: [],
      },
      warnings: [],
    }
  }
}
