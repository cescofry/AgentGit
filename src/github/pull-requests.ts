import { parseMetadataComment } from "../utils/metadata"
import { verifySignature } from "../security/signing"

export interface PrCreateParams {
  owner: string
  repo: string
  title: string
  body: string // includes signed metadata
  head: string // branch name
  base: string // target branch (e.g., "main")
  issueNumber: number
}

/**
 * Create a PR and link it to an issue.
 * Returns the PR number and URL.
 */
export async function createPullRequest(
  octokit: any,
  params: PrCreateParams,
): Promise<{ prNumber: number; prUrl: string }> {
  const { owner, repo, title, body, head, base, issueNumber } = params

  // Create the pull request
  const response = await octokit.rest.pulls.create({
    owner,
    repo,
    title,
    body,
    head,
    base,
  })

  const prNumber = response.data.number
  const prUrl = response.data.html_url

  // Link PR to issue by adding a comment on the issue
  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: issueNumber,
    body: `Pull request #${prNumber} has been opened to address this issue.\n\n${prUrl}`,
  })

  return { prNumber, prUrl }
}

/**
 * Verify PR provenance -- was this PR created by our bot?
 *
 * Checks:
 * 1. PR author is the expected bot user
 * 2. Branch name starts with the expected prefix
 * 3. PR body contains a valid signed metadata block
 */
export function verifyPrProvenance(
  pr: {
    user: { login: string; type: string }
    body: string
    head: { ref: string }
  },
  appSlug: string,
  branchPrefix: string,
  signingSecret: string,
): { valid: boolean; reason?: string } {
  // 1. Check that PR author is the bot
  const expectedLogin = `${appSlug}[bot]`
  if (pr.user.type !== "Bot" || pr.user.login !== expectedLogin) {
    return {
      valid: false,
      reason: `PR author "${pr.user.login}" (type: ${pr.user.type}) is not the expected bot "${expectedLogin}"`,
    }
  }

  // 2. Check branch prefix
  const prefix = branchPrefix.endsWith("/") ? branchPrefix : `${branchPrefix}/`
  if (!pr.head.ref.startsWith(prefix)) {
    return {
      valid: false,
      reason: `Branch "${pr.head.ref}" does not start with expected prefix "${prefix}"`,
    }
  }

  // 3. Check signed metadata in PR body
  const parsed = parseMetadataComment(pr.body)
  if (!parsed) {
    return {
      valid: false,
      reason: "PR body does not contain agent metadata",
    }
  }

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
