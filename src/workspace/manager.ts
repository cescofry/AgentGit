import * as fs from "fs"
import * as path from "path"

export interface WorkspaceInfo {
  path: string // absolute path to workspace directory
  issueNumber: number
  repoName: string
  branch: string
  createdAt: Date
}

export interface WorkspaceManager {
  /** Create a new workspace directory for an issue. */
  create(
    rootDir: string,
    repoName: string,
    issueNumber: number,
    branchPrefix: string,
  ): Promise<WorkspaceInfo>

  /** Clean up a workspace directory. */
  cleanup(workspacePath: string): Promise<void>

  /** List existing workspaces under rootDir. */
  list(rootDir: string): Promise<WorkspaceInfo[]>
}

/**
 * Derive a short slug from an issue number for branch naming.
 * Branch format: {branchPrefix}issue-{number}
 */
function makeBranchName(branchPrefix: string, issueNumber: number): string {
  // Ensure prefix ends with '/' if it doesn't already
  const prefix = branchPrefix.endsWith("/") ? branchPrefix : `${branchPrefix}/`
  return `${prefix}issue-${issueNumber}`
}

/**
 * Create the default WorkspaceManager implementation.
 */
export function createWorkspaceManager(): WorkspaceManager {
  return {
    async create(
      rootDir: string,
      repoName: string,
      issueNumber: number,
      branchPrefix: string,
    ): Promise<WorkspaceInfo> {
      const workspacePath = path.join(rootDir, repoName, `issue-${issueNumber}`)

      // Create directory (recursive, like mkdir -p)
      fs.mkdirSync(workspacePath, { recursive: true })

      const branch = makeBranchName(branchPrefix, issueNumber)

      return {
        path: workspacePath,
        issueNumber,
        repoName,
        branch,
        createdAt: new Date(),
      }
    },

    async cleanup(workspacePath: string): Promise<void> {
      if (fs.existsSync(workspacePath)) {
        fs.rmSync(workspacePath, { recursive: true, force: true })
      }
    },

    async list(rootDir: string): Promise<WorkspaceInfo[]> {
      const workspaces: WorkspaceInfo[] = []

      if (!fs.existsSync(rootDir)) {
        return workspaces
      }

      // Scan rootDir for repo directories
      const repoDirs = fs.readdirSync(rootDir, { withFileTypes: true })

      for (const repoDir of repoDirs) {
        if (!repoDir.isDirectory()) continue

        const repoPath = path.join(rootDir, repoDir.name)
        const issueDirs = fs.readdirSync(repoPath, { withFileTypes: true })

        for (const issueDir of issueDirs) {
          if (!issueDir.isDirectory()) continue

          // Parse issue number from directory name "issue-{number}"
          const match = issueDir.name.match(/^issue-(\d+)$/)
          if (!match) continue

          const issueNumber = parseInt(match[1], 10)
          const fullPath = path.join(repoPath, issueDir.name)
          const stat = fs.statSync(fullPath)

          workspaces.push({
            path: fullPath,
            issueNumber,
            repoName: repoDir.name,
            branch: `agent/issue-${issueNumber}`,
            createdAt: stat.birthtime,
          })
        }
      }

      return workspaces
    },
  }
}
