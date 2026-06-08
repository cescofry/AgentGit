import { parseMetadataComment } from "../utils/metadata"
import { verifySignature } from "../security/signing"

export interface CommentAuthor {
  login: string
  type: string // "Bot" | "User" | etc.
}

/**
 * Check if a comment was authored by our bot.
 * GitHub App bots have type "Bot" and login "{app-slug}[bot]".
 */
export function isBotComment(
  comment: { user: CommentAuthor },
  appSlug: string,
): boolean {
  const expectedLogin = `${appSlug}[bot]`
  return (
    comment.user.type === "Bot" &&
    comment.user.login === expectedLogin
  )
}

/**
 * Verify a metadata comment: check author is bot AND signature is valid.
 * Returns { valid: true } if both checks pass, or { valid: false, reason } if not.
 */
export function verifyCommentProvenance(
  comment: { user: CommentAuthor; body: string },
  appSlug: string,
  signingSecret: string,
): { valid: boolean; reason?: string } {
  // Step 1: verify the comment author is our bot
  if (!isBotComment(comment, appSlug)) {
    return {
      valid: false,
      reason: `Comment author "${comment.user.login}" (type: ${comment.user.type}) is not the expected bot "${appSlug}[bot]"`,
    }
  }

  // Step 2: extract metadata from the comment body
  const parsed = parseMetadataComment(comment.body)
  if (!parsed) {
    return {
      valid: false,
      reason: "Comment does not contain agent metadata",
    }
  }

  // Step 3: verify the signature
  const metadata = parsed.metadata as Record<string, any>
  if (!metadata.signature) {
    return {
      valid: false,
      reason: "Metadata is missing signature field",
    }
  }

  if (!verifySignature(metadata, signingSecret)) {
    return {
      valid: false,
      reason: "Metadata signature verification failed",
    }
  }

  return { valid: true }
}
