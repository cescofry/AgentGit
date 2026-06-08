export interface LabelDefinition {
  name: string
  color: string // hex without #
  description: string
  category: "state" | "classification"
}

// Core state labels - exactly one should be present on an issue at a time
export const STATE_LABELS: LabelDefinition[] = [
  { name: "agent:ready", color: "0E8A16", description: "Issue is ready for agent work.", category: "state" },
  { name: "agent:security-review", color: "D93F0B", description: "Task safety review in progress.", category: "state" },
  { name: "agent:locked-security", color: "B60205", description: "Task failed safety review.", category: "state" },
  { name: "agent:planning", color: "1D76DB", description: "Agent is generating a plan.", category: "state" },
  { name: "agent:plan-review", color: "5319E7", description: "Plan posted, awaiting admin review.", category: "state" },
  { name: "agent:approved", color: "0E8A16", description: "Plan approved for execution.", category: "state" },
  { name: "agent:working", color: "FBCA04", description: "Agent is implementing the plan.", category: "state" },
  { name: "agent:pr-opened", color: "0075CA", description: "PR opened and linked to issue.", category: "state" },
  { name: "agent:blocked", color: "D93F0B", description: "Agent needs human input.", category: "state" },
  { name: "agent:done", color: "EDEDED", description: "Work completed.", category: "state" },
  { name: "agent:cancelled", color: "EDEDED", description: "Agent flow cancelled.", category: "state" },
]

// Classification labels - can coexist with state labels
export const CLASSIFICATION_LABELS: LabelDefinition[] = [
  { name: "agent:type:bug", color: "D73A4A", description: "Bug fix task.", category: "classification" },
  { name: "agent:type:feature", color: "A2EEEF", description: "Feature implementation task.", category: "classification" },
  { name: "agent:type:docs", color: "0075CA", description: "Documentation task.", category: "classification" },
  { name: "agent:type:ui", color: "7057FF", description: "UI replication task.", category: "classification" },
  { name: "agent:needs-admin", color: "D93F0B", description: "Waiting for admin.", category: "classification" },
  { name: "agent:needs-info", color: "FBCA04", description: "Issue lacks detail.", category: "classification" },
  { name: "agent:retryable", color: "C5DEF5", description: "Failure is retryable.", category: "classification" },
]

export const ALL_LABELS: LabelDefinition[] = [...STATE_LABELS, ...CLASSIFICATION_LABELS]

const stateLabelNames = new Set(STATE_LABELS.map((l) => l.name))

/**
 * Get the current state label name from a list of label names.
 * Returns null if no state label is present.
 */
export function getCurrentState(labelNames: string[]): string | null {
  for (const name of labelNames) {
    if (stateLabelNames.has(name)) {
      return name
    }
  }
  return null
}

/**
 * Check if a label name is a state label.
 */
export function isStateLabel(name: string): boolean {
  return stateLabelNames.has(name)
}
