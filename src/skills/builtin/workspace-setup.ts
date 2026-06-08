import { execSync } from "child_process"
import { Skill, SkillInput, SkillResult, ExecutionContext } from "../interface"
import { createWorkspaceManager } from "../../workspace/manager"

export class WorkspaceSetupSkill implements Skill {
  name = "workspace-setup"
  description = "Clone the repo into an ephemeral workspace and prepare the environment."

  async execute(input: SkillInput, context: ExecutionContext): Promise<SkillResult> {
    const repo = input.repo as string
    const branchPrefix = (input.branch_prefix as string) || "agent/"
    const warnings: string[] = []

    if (!repo) {
      return {
        success: false,
        data: {},
        warnings: [],
        error: "Missing required input: repo",
      }
    }

    const { issueNumber, repoName } = context.issueContext
    const workspaceRoot = context.repoConfig.execution_environment.workspace_root

    try {
      // 1. Create workspace directory
      const manager = createWorkspaceManager()
      const workspace = await manager.create(workspaceRoot, repoName, issueNumber, branchPrefix)

      context.logger.info("Created workspace directory", {
        path: workspace.path,
        branch: workspace.branch,
      })

      // 2. Clone repo into workspace
      try {
        execSync(`git clone --depth 1 ${repo} .`, {
          cwd: workspace.path,
          stdio: "pipe",
          timeout: 120_000, // 2 minutes
        })
      } catch (err: any) {
        return {
          success: false,
          data: { workspace_path: workspace.path },
          warnings: [],
          error: `Failed to clone repository: ${err.message}`,
        }
      }

      context.logger.info("Cloned repository", { repo })

      // 3. Create and checkout agent branch
      try {
        execSync(`git checkout -b ${workspace.branch}`, {
          cwd: workspace.path,
          stdio: "pipe",
        })
      } catch (err: any) {
        return {
          success: false,
          data: { workspace_path: workspace.path },
          warnings: [],
          error: `Failed to create branch ${workspace.branch}: ${err.message}`,
        }
      }

      context.logger.info("Created and checked out branch", { branch: workspace.branch })

      return {
        success: true,
        data: {
          workspace_path: workspace.path,
          branch: workspace.branch,
          repo_name: repoName,
          issue_number: issueNumber,
        },
        warnings,
      }
    } catch (err: any) {
      return {
        success: false,
        data: {},
        warnings: [],
        error: `Workspace setup failed: ${err.message}`,
      }
    }
  }
}
