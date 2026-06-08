import { IssueContext } from "../harness/interface"
import { AgentGitConfig } from "../config/defaults"

// ── Types ──

/**
 * Resolution context contains all the data that $-prefixed references can
 * point to. This is populated by the task runner as phases complete.
 */
export interface ResolutionContext {
  issue: IssueContext
  config: AgentGitConfig
  plan?: string
  phases: Record<string, any> // { "phase-name": SkillResult }
  build?: {
    phases: Record<string, any> // { "phase-name": SkillResult }
  }
}

// ── Reference resolution ──

/**
 * Traverse an object by a dot-separated path.
 * Returns undefined if any segment along the path does not exist.
 */
function getByPath(obj: any, path: string): any {
  const segments = path.split(".")
  let current = obj
  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined
    }
    if (typeof current !== "object") {
      return undefined
    }
    current = current[segment]
  }
  return current
}

/**
 * Resolve a single $-prefixed reference string against the context.
 *
 * Resolution rules:
 * - If value doesn't start with $, return as-is.
 * - "$issue" -> context.issue
 * - "$config" -> context.config
 * - "$config.execution.harness" -> context.config.execution.harness (dot path)
 * - "$plan" -> context.plan
 * - "$phases.NAME.result" -> context.phases[NAME].data
 * - "$phases.NAME.result.FIELD" -> context.phases[NAME].data.FIELD
 * - "$build.phases.NAME.result" -> context.build.phases[NAME].data
 * - "$build.phases.NAME.result.FIELD" -> context.build.phases[NAME].data.FIELD
 * - Unknown references throw with a clear error message.
 */
export function resolveReference(ref: string, context: ResolutionContext): any {
  if (typeof ref !== "string" || !ref.startsWith("$")) {
    return ref
  }

  const path = ref.slice(1) // strip leading $

  // Split into segments for structured resolution
  const segments = path.split(".")

  const root = segments[0]

  // -- $issue --
  if (root === "issue") {
    if (segments.length === 1) {
      return context.issue
    }
    const rest = segments.slice(1).join(".")
    const result = getByPath(context.issue, rest)
    if (result === undefined) {
      throw new Error(`Reference "${ref}" resolved to undefined: no such path on issue context`)
    }
    return result
  }

  // -- $config --
  if (root === "config") {
    if (segments.length === 1) {
      return context.config
    }
    const rest = segments.slice(1).join(".")
    const result = getByPath(context.config, rest)
    if (result === undefined) {
      throw new Error(`Reference "${ref}" resolved to undefined: no such path on config`)
    }
    return result
  }

  // -- $plan --
  if (root === "plan") {
    if (segments.length === 1) {
      return context.plan
    }
    throw new Error(`Reference "${ref}" is invalid: $plan does not have sub-paths`)
  }

  // -- $phases.NAME.result[.FIELD] --
  if (root === "phases") {
    if (segments.length < 3) {
      throw new Error(
        `Reference "${ref}" is invalid: expected $phases.<name>.result[.field]`,
      )
    }
    const phaseName = segments[1]
    const accessor = segments[2] // should be "result"

    if (accessor !== "result") {
      throw new Error(
        `Reference "${ref}" is invalid: expected "result" after phase name, got "${accessor}"`,
      )
    }

    const phaseResult = context.phases[phaseName]
    if (!phaseResult) {
      throw new Error(
        `Reference "${ref}" failed: no result found for phase "${phaseName}"`,
      )
    }

    // $phases.NAME.result -> phaseResult.data
    if (segments.length === 3) {
      return phaseResult.data
    }

    // $phases.NAME.result.FIELD -> phaseResult.data.FIELD...
    const fieldPath = segments.slice(3).join(".")
    const result = getByPath(phaseResult.data, fieldPath)
    if (result === undefined) {
      throw new Error(
        `Reference "${ref}" resolved to undefined: no such field in phase "${phaseName}" result`,
      )
    }
    return result
  }

  // -- $build.phases.NAME.result[.FIELD] --
  if (root === "build") {
    if (segments.length < 4 || segments[1] !== "phases") {
      throw new Error(
        `Reference "${ref}" is invalid: expected $build.phases.<name>.result[.field]`,
      )
    }

    if (!context.build) {
      throw new Error(
        `Reference "${ref}" failed: no build context available`,
      )
    }

    const phaseName = segments[2]
    const accessor = segments[3] // should be "result"

    if (accessor !== "result") {
      throw new Error(
        `Reference "${ref}" is invalid: expected "result" after phase name, got "${accessor}"`,
      )
    }

    const phaseResult = context.build.phases[phaseName]
    if (!phaseResult) {
      throw new Error(
        `Reference "${ref}" failed: no result found for build phase "${phaseName}"`,
      )
    }

    // $build.phases.NAME.result -> phaseResult.data
    if (segments.length === 4) {
      return phaseResult.data
    }

    // $build.phases.NAME.result.FIELD -> phaseResult.data.FIELD...
    const fieldPath = segments.slice(4).join(".")
    const result = getByPath(phaseResult.data, fieldPath)
    if (result === undefined) {
      throw new Error(
        `Reference "${ref}" resolved to undefined: no such field in build phase "${phaseName}" result`,
      )
    }
    return result
  }

  throw new Error(
    `Reference "${ref}" is invalid: unknown root "$${root}". Valid roots: $issue, $config, $plan, $phases, $build`,
  )
}

/**
 * Resolve all inputs for a phase definition.
 *
 * Each value in the input map is resolved as a reference. Non-$ values are
 * passed through unchanged.
 *
 * @param inputs  - The input mapping from a PhaseDefinition, or undefined
 * @param context - The resolution context with issue, config, and prior results
 * @returns A map of resolved input values
 */
export function resolveInputs(
  inputs: Record<string, string> | undefined,
  context: ResolutionContext,
): Record<string, any> {
  if (!inputs) {
    return {}
  }

  const resolved: Record<string, any> = {}
  for (const [key, value] of Object.entries(inputs)) {
    resolved[key] = resolveReference(value, context)
  }
  return resolved
}
