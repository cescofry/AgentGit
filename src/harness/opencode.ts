import { execSync } from "child_process"
import {
  CodingHarness,
  IssueContext,
  RepoConfig,
  PlanResult,
  ExecutionResult,
} from "./interface"

/**
 * Build a prompt string that describes the issue for the coding harness.
 */
function buildIssuePrompt(issueContext: IssueContext, repoConfig: RepoConfig): string {
  const lines: string[] = [
    `Repository: ${issueContext.repoOwner}/${issueContext.repoName}`,
    `Issue #${issueContext.issueNumber}: ${issueContext.issueTitle}`,
    "",
    "## Issue Description",
    "",
    issueContext.issueBody,
  ]

  if (issueContext.comments.length > 0) {
    lines.push("", "## Discussion", "")
    for (const comment of issueContext.comments) {
      lines.push(`**@${comment.author}** (${comment.createdAt}):`)
      lines.push(comment.body)
      lines.push("")
    }
  }

  if (issueContext.labels.length > 0) {
    lines.push("", `Labels: ${issueContext.labels.join(", ")}`)
  }

  lines.push("", `Task type: ${repoConfig.taskType}`)

  if (repoConfig.instructions) {
    lines.push("", "## Instructions", "", repoConfig.instructions)
  }

  if (repoConfig.testCommand) {
    lines.push("", `Test command: ${repoConfig.testCommand}`)
  }

  return lines.join("\n")
}

/**
 * Parse plan text output from opencode into a structured PlanResult.
 * Falls back gracefully if the output is unstructured.
 */
function parsePlanOutput(output: string, version: number): PlanResult {
  const warnings: string[] = []

  // Try to extract confidence from output if the agent included it
  let confidence = 0.7 // default moderate confidence
  const confidenceMatch = output.match(/confidence:\s*([\d.]+)/i)
  if (confidenceMatch) {
    const parsed = parseFloat(confidenceMatch[1])
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
      confidence = parsed
    }
  }

  // Check for warning indicators
  if (output.toLowerCase().includes("warning:")) {
    const warningLines = output
      .split("\n")
      .filter((line) => line.toLowerCase().includes("warning:"))
    warnings.push(...warningLines.map((l) => l.trim()))
  }

  return {
    plan: output.trim(),
    planVersion: version,
    confidence,
    warnings,
  }
}

/**
 * Parse execution output from opencode into a structured ExecutionResult.
 */
function parseExecutionOutput(
  output: string,
  branch: string,
): ExecutionResult {
  const errors: string[] = []

  // Check for error indicators
  if (output.toLowerCase().includes("error:")) {
    const errorLines = output
      .split("\n")
      .filter((line) => line.toLowerCase().includes("error:"))
    errors.push(...errorLines.map((l) => l.trim()))
  }

  // Extract PR URL if mentioned
  let prUrl: string | undefined
  const prMatch = output.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/)
  if (prMatch) {
    prUrl = prMatch[0]
  }

  // Extract test results if present
  let testResults: string | undefined
  const testMatch = output.match(/(?:test results?|tests?):?\s*\n([\s\S]*?)(?:\n\n|$)/i)
  if (testMatch) {
    testResults = testMatch[1].trim()
  }

  const success = errors.length === 0

  return {
    success,
    branch,
    prUrl,
    diffSummary: output.trim(),
    testResults,
    errors,
  }
}

/**
 * Escape a string for safe use in shell commands.
 */
function shellEscape(str: string): string {
  // Replace single quotes with '\'' (end quote, escaped quote, start quote)
  return `'${str.replace(/'/g, "'\\''")}'`
}

export class OpenCodeHarness implements CodingHarness {
  name = "opencode"

  constructor(private model?: string) {}

  async proposePlan(
    issueContext: IssueContext,
    repoConfig: RepoConfig,
  ): Promise<PlanResult> {
    const model = this.model || "anthropic/claude-sonnet-4-20250514"
    const issuePrompt = buildIssuePrompt(issueContext, repoConfig)

    const prompt = [
      "You are an AI coding agent. Given the following issue, propose a detailed implementation plan.",
      "Do NOT make any code changes. Only produce a plan.",
      "",
      "Output your plan in markdown with these sections:",
      "- Summary: Brief description of what will be done",
      "- Steps: Numbered implementation steps",
      "- Files to Modify: List of files and what changes are needed",
      "- Testing Strategy: How to verify the changes",
      "",
      issuePrompt,
    ].join("\n")

    try {
      const output = execSync(
        `opencode run --agent plan --model ${shellEscape(model)} ${shellEscape(prompt)}`,
        {
          encoding: "utf-8",
          timeout: repoConfig.maxRuntimeMinutes * 60 * 1000,
          stdio: ["pipe", "pipe", "pipe"],
        },
      )

      return parsePlanOutput(output, 1)
    } catch (err: any) {
      return {
        plan: "",
        planVersion: 1,
        confidence: 0,
        warnings: [
          `OpenCode plan generation failed: ${err.message || String(err)}`,
        ],
      }
    }
  }

  async revisePlan(
    issueContext: IssueContext,
    priorPlan: string,
    adminFeedback: string,
    repoConfig: RepoConfig,
  ): Promise<PlanResult> {
    const model = this.model || "anthropic/claude-sonnet-4-20250514"
    const issuePrompt = buildIssuePrompt(issueContext, repoConfig)

    // Extract version from prior plan or default to 1
    const versionMatch = priorPlan.match(/\(v(\d+)\)/i)
    const priorVersion = versionMatch ? parseInt(versionMatch[1], 10) : 1
    const newVersion = priorVersion + 1

    const prompt = [
      "You are an AI coding agent. Revise the following implementation plan based on admin feedback.",
      "Do NOT make any code changes. Only produce a revised plan.",
      "",
      "## Original Issue",
      "",
      issuePrompt,
      "",
      "## Prior Plan",
      "",
      priorPlan,
      "",
      "## Admin Feedback",
      "",
      adminFeedback,
      "",
      "Output the revised plan in markdown with these sections:",
      "- Summary: Brief description of what will be done",
      "- Steps: Numbered implementation steps",
      "- Files to Modify: List of files and what changes are needed",
      "- Testing Strategy: How to verify the changes",
    ].join("\n")

    try {
      const output = execSync(
        `opencode run --agent plan --model ${shellEscape(model)} ${shellEscape(prompt)}`,
        {
          encoding: "utf-8",
          timeout: repoConfig.maxRuntimeMinutes * 60 * 1000,
          stdio: ["pipe", "pipe", "pipe"],
        },
      )

      return parsePlanOutput(output, newVersion)
    } catch (err: any) {
      return {
        plan: "",
        planVersion: newVersion,
        confidence: 0,
        warnings: [
          `OpenCode plan revision failed: ${err.message || String(err)}`,
        ],
      }
    }
  }

  async executePlan(
    issueContext: IssueContext,
    approvedPlan: string,
    workspace: string,
    repoConfig: RepoConfig,
  ): Promise<ExecutionResult> {
    const model = this.model || "anthropic/claude-sonnet-4-20250514"
    const branch = `${repoConfig.branchPrefix}issue-${issueContext.issueNumber}`

    const prompt = [
      "You are an AI coding agent. Execute the following approved implementation plan.",
      "Make all necessary code changes in the workspace.",
      "",
      `Repository: ${issueContext.repoOwner}/${issueContext.repoName}`,
      `Issue #${issueContext.issueNumber}: ${issueContext.issueTitle}`,
      "",
      "## Approved Plan",
      "",
      approvedPlan,
    ].join("\n")

    if (repoConfig.testCommand && repoConfig.testCommand !== "auto") {
      prompt.concat(`\n\nAfter making changes, run the test command: ${repoConfig.testCommand}`)
    }

    try {
      const output = execSync(
        `opencode run --agent build --model ${shellEscape(model)} --dangerously-skip-permissions ${shellEscape(prompt)}`,
        {
          encoding: "utf-8",
          cwd: workspace,
          timeout: repoConfig.maxRuntimeMinutes * 60 * 1000,
          stdio: ["pipe", "pipe", "pipe"],
        },
      )

      return parseExecutionOutput(output, branch)
    } catch (err: any) {
      return {
        success: false,
        branch,
        diffSummary: "",
        errors: [
          `OpenCode execution failed: ${err.message || String(err)}`,
        ],
      }
    }
  }
}

// Exported for testing
export { buildIssuePrompt, parsePlanOutput, parseExecutionOutput, shellEscape }
