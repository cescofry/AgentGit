/**
 * Create a branch from the default branch (or a specified base branch).
 *
 * Steps:
 * 1. Get the SHA of the base branch's HEAD
 * 2. Create a new ref pointing to that SHA
 */
export async function createBranch(
  octokit: any,
  owner: string,
  repo: string,
  branchName: string,
  baseBranch: string = "main",
): Promise<void> {
  // Get the SHA of the base branch
  const { data: refData } = await octokit.rest.git.getRef({
    owner,
    repo,
    ref: `heads/${baseBranch}`,
  })

  const baseSha = refData.object.sha

  // Create the new branch ref
  await octokit.rest.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branchName}`,
    sha: baseSha,
  })
}
