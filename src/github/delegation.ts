import { parseMetadataComment, createMetadataComment } from "../utils/metadata"
import { verifySignature } from "../security/signing"
import { isBotComment } from "./identity"

// ── Interfaces ──

export interface DelegationMetadata {
  kind: "delegation"
  issue: number
  delegated_by: string
  delegated_to: string
  scopes: string[] // e.g. ["plan", "revise", "approve", "run"]
  created_at: string // ISO datetime
  expires_at: string | null
  revoked_at: string | null
  signature?: string
}

export interface RevocationMetadata {
  kind: "delegation-revocation"
  issue: number
  delegated_to: string
  revoked_by: string
  revoked_at: string
  signature?: string
}

// ── Constants ──

/** Default scopes when no scope is specified. */
export const DEFAULT_DELEGATION_SCOPES = ["plan", "revise", "approve", "run"] as const

/** Valid delegation scopes. */
export const VALID_DELEGATION_SCOPES = ["plan", "revise", "approve", "run", "retry"] as const

const validScopeSet = new Set<string>(VALID_DELEGATION_SCOPES)

// ── Functions ──

/**
 * Parse delegation args from "/agent delegate @user [scope1 scope2 ...]".
 * The `args` parameter is everything after "delegate", e.g. "@alice plan revise".
 *
 * Returns null if the input is invalid (no @username found).
 */
export function parseDelegateArgs(
  args: string,
): { username: string; scopes: string[] } | null {
  const trimmed = args.trim()
  if (!trimmed) {
    return null
  }

  // Extract @username — must start with @
  const match = trimmed.match(/^@([a-zA-Z0-9_-]+)/)
  if (!match) {
    return null
  }

  const username = match[1]

  // Everything after the @username is scope tokens
  const rest = trimmed.slice(match[0].length).trim()
  if (!rest) {
    return { username, scopes: [...DEFAULT_DELEGATION_SCOPES] }
  }

  const tokens = rest.split(/\s+/).filter(Boolean)
  const scopes = tokens.filter((t) => validScopeSet.has(t.toLowerCase()))

  if (scopes.length === 0) {
    // All tokens were invalid scope names — use defaults
    return { username, scopes: [...DEFAULT_DELEGATION_SCOPES] }
  }

  return { username, scopes: scopes.map((s) => s.toLowerCase()) }
}

/**
 * Create a delegation metadata comment body.
 * The result is a string suitable for posting as a GitHub issue comment.
 */
export function createDelegationComment(
  issueNumber: number,
  delegatedBy: string,
  delegatedTo: string,
  scopes: string[],
  signingSecret: string,
): string {
  const now = new Date().toISOString()

  const metadata: Omit<DelegationMetadata, "signature"> = {
    kind: "delegation",
    issue: issueNumber,
    delegated_by: delegatedBy,
    delegated_to: delegatedTo,
    scopes,
    created_at: now,
    expires_at: null,
    revoked_at: null,
  }

  const humanBody = [
    `**Delegation granted** by @${delegatedBy}`,
    "",
    `@${delegatedTo} is now delegated for: ${scopes.map((s) => `\`${s}\``).join(", ")}`,
    "",
    "_Use `/agent undelegate @${delegatedTo}` to revoke._",
  ].join("\n")

  return createMetadataComment(metadata, humanBody, signingSecret)
}

/**
 * Create a revocation comment body.
 * Revocations are recorded as separate comments (not edits).
 */
export function createRevocationComment(
  issueNumber: number,
  revokedBy: string,
  delegatedTo: string,
  signingSecret: string,
): string {
  const now = new Date().toISOString()

  const metadata: Omit<RevocationMetadata, "signature"> = {
    kind: "delegation-revocation",
    issue: issueNumber,
    delegated_to: delegatedTo,
    revoked_by: revokedBy,
    revoked_at: now,
  }

  const humanBody = [
    `**Delegation revoked** by @${revokedBy}`,
    "",
    `@${delegatedTo}'s delegation on this issue has been revoked.`,
  ].join("\n")

  return createMetadataComment(metadata, humanBody, signingSecret)
}

/**
 * Scan issue comments and return all active (non-revoked, non-expired) delegations.
 *
 * Logic:
 * 1. Filter to bot comments only.
 * 2. Parse metadata from each comment.
 * 3. Collect delegations (kind === "delegation") and revocations (kind === "delegation-revocation").
 * 4. A delegation is revoked if a revocation comment for the same delegated_to user
 *    exists at a later index than the delegation comment.
 * 5. A delegation is expired if expires_at is set and is in the past.
 * 6. Verify signature on each delegation.
 */
export function getActiveDelegations(
  comments: Array<{ user: { login: string; type: string }; body: string }>,
  appSlug: string,
  signingSecret: string,
  issueNumber: number,
): DelegationMetadata[] {
  // First pass: collect all delegation and revocation entries with their indices
  const delegations: Array<{ index: number; metadata: DelegationMetadata }> = []
  const revocations: Array<{ index: number; metadata: RevocationMetadata }> = []

  for (let i = 0; i < comments.length; i++) {
    const comment = comments[i]

    // Only consider bot comments
    if (!isBotComment(comment, appSlug)) {
      continue
    }

    const parsed = parseMetadataComment<DelegationMetadata | RevocationMetadata>(
      comment.body,
    )
    if (!parsed) {
      continue
    }

    const { metadata } = parsed

    // Verify signature
    if (!verifySignature(metadata, signingSecret)) {
      continue
    }

    // Check issue number matches
    if ("issue" in metadata && metadata.issue !== issueNumber) {
      continue
    }

    if (metadata.kind === "delegation") {
      delegations.push({ index: i, metadata: metadata as DelegationMetadata })
    } else if (metadata.kind === "delegation-revocation") {
      revocations.push({ index: i, metadata: metadata as RevocationMetadata })
    }
  }

  // Second pass: filter out revoked and expired delegations
  const now = new Date()
  const active: DelegationMetadata[] = []

  for (const { index, metadata } of delegations) {
    // Check if explicitly revoked via revoked_at field
    if (metadata.revoked_at !== null) {
      continue
    }

    // Check if expired
    if (metadata.expires_at !== null && new Date(metadata.expires_at) <= now) {
      continue
    }

    // Check if a revocation comment exists for this user AFTER this delegation
    const isRevoked = revocations.some(
      (r) =>
        r.index > index &&
        r.metadata.delegated_to.toLowerCase() ===
          metadata.delegated_to.toLowerCase(),
    )
    if (isRevoked) {
      continue
    }

    active.push(metadata)
  }

  return active
}

/**
 * Check if a user has a delegation for a specific command on an issue.
 *
 * @param delegations - List of active delegations (from getActiveDelegations)
 * @param username    - The GitHub login to check
 * @param command     - The command name (e.g. "plan", "run")
 */
export function isDelegatedFor(
  delegations: DelegationMetadata[],
  username: string,
  command: string,
): boolean {
  const userLower = username.toLowerCase()
  const cmdLower = command.toLowerCase()

  return delegations.some(
    (d) =>
      d.delegated_to.toLowerCase() === userLower &&
      d.scopes.some((s) => s.toLowerCase() === cmdLower),
  )
}

/**
 * Format a list of active delegations as a human-readable markdown table.
 * Returns a string suitable for posting in a GitHub comment.
 */
export function formatDelegationsList(delegations: DelegationMetadata[]): string {
  if (delegations.length === 0) {
    return "No active delegations on this issue."
  }

  const header = "| User | Scopes | Delegated By | Created |"
  const separator = "|------|--------|--------------|---------|"

  const rows = delegations.map((d) => {
    const scopes = d.scopes.map((s) => `\`${s}\``).join(", ")
    const created = d.created_at.slice(0, 10) // YYYY-MM-DD
    return `| @${d.delegated_to} | ${scopes} | @${d.delegated_by} | ${created} |`
  })

  return [header, separator, ...rows].join("\n")
}
