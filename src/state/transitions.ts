export type AgentState =
  | null // no agent state label
  | "agent:ready"
  | "agent:security-review"
  | "agent:locked-security"
  | "agent:planning"
  | "agent:plan-review"
  | "agent:approved"
  | "agent:working"
  | "agent:pr-opened"
  | "agent:blocked"
  | "agent:done"
  | "agent:cancelled"

export type Trigger =
  | "plan_requested" // /agent plan or agent:ready label added
  | "security_review_passed" // pre-plan task passes
  | "security_review_failed" // pre-plan task fails (safety check)
  | "unlock_security" // /agent unlock-security
  | "close_unsafe" // /agent close-unsafe
  | "plan_completed" // plan task completes
  | "plan_failed" // plan task fails
  | "revise_requested" // /agent revise
  | "plan_approved" // /agent approve
  | "work_started" // worker claims job
  | "build_completed" // build + post-build tasks complete, PR opened
  | "build_failed" // build or post-build task fails
  | "retry_requested" // /agent retry
  | "pr_merged" // PR merged
  | "stop_requested" // /agent stop
  | "issue_closed" // issue closed externally

export interface TransitionResult {
  valid: boolean
  from: AgentState
  to: AgentState
  trigger: Trigger
  reason?: string // explanation if invalid
}

interface TransitionEntry {
  trigger: Trigger
  to: AgentState
}

/**
 * Define the valid transitions.
 * Key is the serialized current state (use "null" for the null state).
 */
export const TRANSITION_TABLE: Record<string, TransitionEntry[]> = {
  null: [
    { trigger: "plan_requested", to: "agent:security-review" },
    { trigger: "stop_requested", to: "agent:cancelled" },
    { trigger: "issue_closed", to: "agent:cancelled" },
  ],
  "agent:ready": [
    { trigger: "plan_requested", to: "agent:security-review" },
    { trigger: "stop_requested", to: "agent:cancelled" },
    { trigger: "issue_closed", to: "agent:cancelled" },
  ],
  "agent:security-review": [
    { trigger: "security_review_passed", to: "agent:planning" },
    { trigger: "security_review_failed", to: "agent:locked-security" },
    { trigger: "stop_requested", to: "agent:cancelled" },
    { trigger: "issue_closed", to: "agent:cancelled" },
  ],
  "agent:locked-security": [
    { trigger: "unlock_security", to: "agent:planning" },
    { trigger: "close_unsafe", to: null },
    { trigger: "stop_requested", to: "agent:cancelled" },
    { trigger: "issue_closed", to: "agent:cancelled" },
  ],
  "agent:planning": [
    { trigger: "plan_completed", to: "agent:plan-review" },
    { trigger: "plan_failed", to: "agent:blocked" },
    { trigger: "stop_requested", to: "agent:cancelled" },
    { trigger: "issue_closed", to: "agent:cancelled" },
  ],
  "agent:plan-review": [
    { trigger: "revise_requested", to: "agent:planning" },
    { trigger: "plan_approved", to: "agent:approved" },
    { trigger: "stop_requested", to: "agent:cancelled" },
    { trigger: "issue_closed", to: "agent:cancelled" },
  ],
  "agent:approved": [
    { trigger: "work_started", to: "agent:working" },
    { trigger: "stop_requested", to: "agent:cancelled" },
    { trigger: "issue_closed", to: "agent:cancelled" },
  ],
  "agent:working": [
    { trigger: "build_completed", to: "agent:pr-opened" },
    { trigger: "build_failed", to: "agent:blocked" },
    { trigger: "stop_requested", to: "agent:cancelled" },
    { trigger: "issue_closed", to: "agent:cancelled" },
  ],
  "agent:pr-opened": [
    { trigger: "pr_merged", to: "agent:done" },
    { trigger: "stop_requested", to: "agent:cancelled" },
    { trigger: "issue_closed", to: "agent:cancelled" },
  ],
  "agent:blocked": [
    { trigger: "retry_requested", to: "agent:planning" },
    { trigger: "stop_requested", to: "agent:cancelled" },
    { trigger: "issue_closed", to: "agent:cancelled" },
  ],
  "agent:done": [
    { trigger: "issue_closed", to: "agent:cancelled" },
  ],
  "agent:cancelled": [
    { trigger: "plan_requested", to: "agent:security-review" },
  ],
}

/**
 * Serialize an AgentState to a string key for table lookup.
 */
function stateKey(state: AgentState): string {
  return state === null ? "null" : state
}

/**
 * Get the next state given current state and trigger.
 * Returns a TransitionResult indicating whether the transition is valid.
 */
export function getNextState(current: AgentState, trigger: Trigger): TransitionResult {
  const key = stateKey(current)
  const entries = TRANSITION_TABLE[key]

  if (!entries) {
    return {
      valid: false,
      from: current,
      to: current,
      trigger,
      reason: `No transitions defined for state "${key}".`,
    }
  }

  const match = entries.find((e) => e.trigger === trigger)

  if (!match) {
    const validTriggers = entries.map((e) => e.trigger).join(", ")
    return {
      valid: false,
      from: current,
      to: current,
      trigger,
      reason: `Trigger "${trigger}" is not valid from state "${key}". Valid triggers: ${validTriggers}.`,
    }
  }

  return {
    valid: true,
    from: current,
    to: match.to,
    trigger,
  }
}

/**
 * Get all valid triggers for a given state.
 */
export function getValidTriggers(state: AgentState): Trigger[] {
  const key = stateKey(state)
  const entries = TRANSITION_TABLE[key]

  if (!entries) {
    return []
  }

  return entries.map((e) => e.trigger)
}
