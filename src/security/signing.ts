import * as crypto from "crypto"

export interface SignableMetadata {
  [key: string]: any
  signature?: string
}

/**
 * Create a canonical JSON string for signing.
 * Sorts keys alphabetically at every depth and removes the 'signature' field.
 */
export function canonicalize(metadata: SignableMetadata): string {
  return JSON.stringify(sortKeys(stripSignature(metadata)))
}

/**
 * Compute HMAC-SHA256 over canonical JSON of all fields except 'signature'.
 * Returns the hex-encoded signature string.
 */
export function signMetadata(metadata: SignableMetadata, secret: string): string {
  const canonical = canonicalize(metadata)
  const hmac = crypto.createHmac("sha256", secret)
  hmac.update(canonical)
  return hmac.digest("hex")
}

/**
 * Verify that the metadata's signature field matches a fresh HMAC computation.
 * Returns false if no signature is present or if it doesn't match.
 */
export function verifySignature(metadata: SignableMetadata, secret: string): boolean {
  const { signature } = metadata
  if (!signature) {
    return false
  }

  const expected = signMetadata(metadata, secret)
  // Use timingSafeEqual to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expected, "hex"),
    )
  } catch {
    // If buffers have different lengths, timingSafeEqual throws
    return false
  }
}

/**
 * Remove the 'signature' key from a metadata object (shallow clone).
 */
function stripSignature(obj: SignableMetadata): Record<string, any> {
  const { signature: _, ...rest } = obj
  return rest
}

/**
 * Deep-sort all object keys alphabetically.
 */
function sortKeys(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(sortKeys)
  }
  if (obj !== null && typeof obj === "object") {
    const sorted: Record<string, any> = {}
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortKeys(obj[key])
    }
    return sorted
  }
  return obj
}
