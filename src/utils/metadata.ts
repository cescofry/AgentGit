import { signMetadata } from "../security/signing"

const METADATA_PATTERN = /<!--\s*agent-metadata\s*\n([\s\S]*?)\n\s*-->/

export interface MetadataComment<T = Record<string, any>> {
  metadata: T
  body: string
  raw: string
}

/**
 * Extract metadata from a comment body string.
 * Returns null if the comment does not contain an agent-metadata block.
 */
export function parseMetadataComment<T = Record<string, any>>(
  commentBody: string,
): MetadataComment<T> | null {
  const match = commentBody.match(METADATA_PATTERN)
  if (!match) {
    return null
  }

  let metadata: T
  try {
    metadata = JSON.parse(match[1].trim())
  } catch {
    return null
  }

  // The human-visible body is everything after the metadata comment block
  const metadataBlockEnd = match.index! + match[0].length
  const body = commentBody.slice(metadataBlockEnd).replace(/^\n+/, "")

  return {
    metadata,
    body,
    raw: commentBody,
  }
}

/**
 * Create a comment body with embedded signed metadata.
 * The metadata is signed using HMAC-SHA256, and the signature is embedded in the JSON.
 */
export function createMetadataComment(
  metadata: Record<string, any>,
  humanBody: string,
  secret: string,
): string {
  // Sign the metadata and add signature to the object
  const signature = signMetadata(metadata, secret)
  const signed = { ...metadata, signature }
  const json = JSON.stringify(signed, null, 2)

  return `<!-- agent-metadata\n${json}\n-->\n\n${humanBody}`
}

/**
 * Check if a comment body contains an agent-metadata block.
 */
export function hasMetadata(commentBody: string): boolean {
  return METADATA_PATTERN.test(commentBody)
}
