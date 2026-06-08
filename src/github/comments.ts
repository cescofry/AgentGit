import { createMetadataComment } from "../utils/metadata"

/**
 * Create a plan comment with signed metadata.
 *
 * The metadata block embeds the plan version, issue number, harness, and model
 * so downstream phases (approval, execution) can verify provenance.
 */
export function createPlanComment(
  plan: string,
  planVersion: number,
  issueNumber: number,
  harness: string,
  model: string,
  signingSecret: string,
): string {
  const metadata: Record<string, any> = {
    kind: "plan",
    issue: issueNumber,
    plan_version: planVersion,
    harness,
    model,
  }

  const humanBody = `## Proposed Plan (v${planVersion})\n\n${plan}\n\n---\n*Reply with \`/approve\` to approve this plan, or provide feedback to request changes.*`

  return createMetadataComment(metadata, humanBody, signingSecret)
}

/**
 * Create a plain status update comment (no metadata).
 */
export function createStatusComment(status: string, details?: string): string {
  let body = `**Status:** ${status}`
  if (details) {
    body += `\n\n${details}`
  }
  return body
}

/**
 * Create a blocked/error comment with signed metadata.
 *
 * Used when a phase fails and the issue cannot proceed further
 * without admin intervention.
 */
export function createBlockedComment(
  issueNumber: number,
  reason: string,
  failedPhase: string,
  signingSecret: string,
): string {
  const metadata: Record<string, any> = {
    kind: "blocked",
    issue: issueNumber,
    failed_phase: failedPhase,
  }

  const humanBody = `## Blocked\n\n**Phase:** ${failedPhase}\n**Reason:** ${reason}\n\n---\n*An admin must resolve this issue before the agent can continue.*`

  return createMetadataComment(metadata, humanBody, signingSecret)
}

/**
 * Create a security lock comment with signed metadata.
 *
 * Used when the pre-plan security check flags the issue as potentially unsafe.
 */
export function createSecurityLockComment(
  issueNumber: number,
  category: string,
  reason: string,
  signingSecret: string,
): string {
  const metadata: Record<string, any> = {
    kind: "security-lock",
    issue: issueNumber,
    category,
  }

  const humanBody = `## Security Lock\n\n**Category:** ${category}\n**Reason:** ${reason}\n\n---\n*A security admin must unlock this issue before the agent can proceed.*`

  return createMetadataComment(metadata, humanBody, signingSecret)
}
