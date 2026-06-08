import { Skill, SkillInput, SkillResult, ExecutionContext } from "../interface"

export class PlanExecutorSkill implements Skill {
  name = "plan-executor"
  description = "Run the coding harness to implement the approved plan."

  async execute(input: SkillInput, context: ExecutionContext): Promise<SkillResult> {
    const issueContext = input.issue_context ?? context.issueContext
    const approvedPlan = input.approved_plan as string
    const workspace = input.workspace as string

    if (!approvedPlan) {
      return {
        success: false,
        data: {},
        warnings: [],
        error: "Missing required input: approved_plan",
      }
    }

    if (!workspace) {
      return {
        success: false,
        data: {},
        warnings: [],
        error: "Missing required input: workspace",
      }
    }

    const repoConfig = {
      taskType: context.repoConfig.task_types ? "feature" : "feature",
      instructions: approvedPlan,
      testCommand: context.repoConfig.execution.test_command,
      maxRuntimeMinutes: context.repoConfig.execution.max_runtime_minutes,
      branchPrefix: context.repoConfig.execution.branch_prefix,
    }

    try {
      context.logger.info("Executing plan via harness", {
        harness: context.harness.name,
        workspace,
      })

      const result = await context.harness.executePlan(
        issueContext,
        approvedPlan,
        workspace,
        repoConfig,
      )

      context.logger.info("Plan execution completed", {
        success: result.success,
        branch: result.branch,
      })

      return {
        success: result.success,
        data: {
          branch: result.branch,
          pr_url: result.prUrl,
          diff_summary: result.diffSummary,
          test_results: result.testResults,
          errors: result.errors,
        },
        warnings: result.errors.length > 0
          ? [`Execution completed with ${result.errors.length} error(s)`]
          : [],
        error: result.success ? undefined : result.errors.join("; "),
      }
    } catch (err: any) {
      context.logger.error("Plan execution failed", { error: err.message })
      return {
        success: false,
        data: {},
        warnings: [],
        error: `Plan execution failed: ${err.message}`,
      }
    }
  }
}
