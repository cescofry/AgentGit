import { Skill, SkillInput, SkillResult, ExecutionContext } from "../interface"
import { RepoConfig } from "../../harness/interface"

/**
 * Generate or revise an implementation plan using the coding harness.
 *
 * Normal mode: calls harness.proposePlan()
 * Revision mode: when input.prior_plan and input.feedback are present,
 *   calls harness.revisePlan() instead.
 */
export class PlanGeneratorSkill implements Skill {
  name = "plan-generator"
  description = "Produce a structured implementation plan using the coding harness."

  async execute(input: SkillInput, context: ExecutionContext): Promise<SkillResult> {
    const issueContext = input.issue_context ?? context.issueContext
    const taskType: string = input.task_type ?? "feature"
    const instructions: string = input.instructions ?? ""

    const repoConfig: RepoConfig = {
      taskType,
      instructions,
      testCommand: context.repoConfig.execution.test_command !== "auto"
        ? context.repoConfig.execution.test_command
        : undefined,
      maxRuntimeMinutes: context.repoConfig.execution.max_runtime_minutes,
      branchPrefix: context.repoConfig.execution.branch_prefix,
    }

    const warnings: string[] = []
    const isRevision = Boolean(input.prior_plan && input.feedback)

    try {
      if (isRevision) {
        context.logger.info("Revising plan", {
          issueNumber: issueContext.issueNumber,
          taskType,
        })

        const result = await context.harness.revisePlan(
          issueContext,
          input.prior_plan,
          input.feedback,
          repoConfig,
        )

        return {
          success: true,
          data: {
            plan: result.plan,
            plan_version: result.planVersion,
            confidence: result.confidence,
            revised: true,
          },
          warnings: [...warnings, ...result.warnings],
        }
      }

      context.logger.info("Generating plan", {
        issueNumber: issueContext.issueNumber,
        taskType,
      })

      const result = await context.harness.proposePlan(issueContext, repoConfig)

      return {
        success: true,
        data: {
          plan: result.plan,
          plan_version: result.planVersion,
          confidence: result.confidence,
          revised: false,
        },
        warnings: [...warnings, ...result.warnings],
      }
    } catch (err: any) {
      const message = err?.message ?? String(err)
      context.logger.error("Plan generation failed", { error: message })

      return {
        success: false,
        data: {},
        warnings,
        error: `Plan generation failed: ${message}`,
      }
    }
  }
}
