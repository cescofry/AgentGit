import { TaskDefinition, PhaseDefinition } from "./loader"
import { resolveInputs, ResolutionContext } from "./resolver"
import { SkillResult } from "../skills/interface"
import { SkillRegistry } from "../skills/registry"
import { ExecutionContext } from "../skills/interface"

// ── Types ──

export interface TaskResult {
  success: boolean
  taskName: string
  phaseResults: Record<string, SkillResult>
  failedPhase?: string
  failureAction?: string // "block" | "lock-security" | "warn" | "skip"
  error?: string
}

export interface TaskRunnerOptions {
  skillRegistry: SkillRegistry
  executionContext: ExecutionContext
  resolutionContext: ResolutionContext
}

// ── Runner ──

/**
 * Run a task definition by executing its phases in order.
 *
 * Execution flow:
 * 1. Iterate phases sequentially.
 * 2. For each phase:
 *    a. Resolve inputs using resolveInputs.
 *    b. Look up the skill in the registry.
 *    c. Execute the skill.
 *    d. On success: store result in phaseResults, continue.
 *    e. On failure:
 *       - "block": store result, set failedPhase, return failure.
 *       - "lock-security": store result, set failedPhase, return failure with action.
 *       - "warn": store result with warning, continue.
 *       - "skip": silently continue.
 *    f. If required=true and phase failed (any on_failure): task fails.
 * 3. Return TaskResult.
 */
export async function runTask(
  task: TaskDefinition,
  options: TaskRunnerOptions,
): Promise<TaskResult> {
  const { skillRegistry, executionContext, resolutionContext } = options
  const phaseResults: Record<string, SkillResult> = {}

  for (const phase of task.phases) {
    const onFailure = phase.on_failure ?? "block"
    const required = phase.required ?? false

    // 1. Look up the skill
    const skill = skillRegistry.get(phase.skill)
    if (!skill) {
      const errorResult: SkillResult = {
        success: false,
        data: {},
        warnings: [],
        error: `Skill "${phase.skill}" not found in registry`,
      }
      phaseResults[phase.name] = errorResult

      // Store the result in resolution context for reference
      resolutionContext.phases[phase.name] = errorResult

      // Missing skill is always a hard failure
      return {
        success: false,
        taskName: task.name,
        phaseResults,
        failedPhase: phase.name,
        failureAction: "block",
        error: `Skill "${phase.skill}" not found in registry`,
      }
    }

    // 2. Resolve inputs
    let resolvedInputs: Record<string, any>
    try {
      resolvedInputs = resolveInputs(phase.inputs, resolutionContext)
    } catch (err: any) {
      const errorResult: SkillResult = {
        success: false,
        data: {},
        warnings: [],
        error: `Input resolution failed for phase "${phase.name}": ${err.message}`,
      }
      phaseResults[phase.name] = errorResult
      resolutionContext.phases[phase.name] = errorResult

      return {
        success: false,
        taskName: task.name,
        phaseResults,
        failedPhase: phase.name,
        failureAction: "block",
        error: errorResult.error,
      }
    }

    // 3. Execute the skill
    let result: SkillResult
    try {
      result = await skill.execute(resolvedInputs, executionContext)
    } catch (err: any) {
      result = {
        success: false,
        data: {},
        warnings: [],
        error: `Skill "${phase.skill}" threw an exception: ${err.message}`,
      }
    }

    // Store result for downstream phases
    phaseResults[phase.name] = result
    resolutionContext.phases[phase.name] = result

    // 4. Handle failure
    if (!result.success) {
      // If required, the task always fails regardless of on_failure
      if (required) {
        return {
          success: false,
          taskName: task.name,
          phaseResults,
          failedPhase: phase.name,
          failureAction: onFailure,
          error: result.error ?? `Required phase "${phase.name}" failed`,
        }
      }

      switch (onFailure) {
        case "block":
          return {
            success: false,
            taskName: task.name,
            phaseResults,
            failedPhase: phase.name,
            failureAction: "block",
            error: result.error ?? `Phase "${phase.name}" failed`,
          }

        case "lock-security":
          return {
            success: false,
            taskName: task.name,
            phaseResults,
            failedPhase: phase.name,
            failureAction: "lock-security",
            error: result.error ?? `Phase "${phase.name}" failed security check`,
          }

        case "warn":
          // Continue execution but the warning is already in the result
          executionContext.logger.warn(
            `Phase "${phase.name}" failed with warning`,
            { error: result.error },
          )
          continue

        case "skip":
          // Silently continue
          continue
      }
    }
  }

  return {
    success: true,
    taskName: task.name,
    phaseResults,
  }
}
