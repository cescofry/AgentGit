import { LabelDefinition, ALL_LABELS, getCurrentState as getStateFromLabels, isStateLabel } from "./labels"
import { AgentState, Trigger, TransitionResult, getNextState } from "./transitions"

export interface StateManager {
  /**
   * Get current agent state from issue labels (fetches fresh from GitHub API).
   */
  getCurrentState(
    octokit: OctokitLike,
    owner: string,
    repo: string,
    issueNumber: number
  ): Promise<AgentState>

  /**
   * Transition to a new state: removes old state label, adds new one.
   * Returns the TransitionResult. If invalid, labels are not changed.
   */
  transition(
    octokit: OctokitLike,
    owner: string,
    repo: string,
    issueNumber: number,
    trigger: Trigger
  ): Promise<TransitionResult>

  /**
   * Ensure label exists on the repo (create if missing).
   */
  ensureLabel(
    octokit: OctokitLike,
    owner: string,
    repo: string,
    label: LabelDefinition
  ): Promise<void>

  /**
   * Ensure all agent labels exist on the repo.
   */
  ensureAllLabels(
    octokit: OctokitLike,
    owner: string,
    repo: string
  ): Promise<void>
}

/**
 * Minimal Octokit-like interface so callers can pass in any compatible client.
 * We only use the rest.issues and rest.repos namespaces.
 */
export interface OctokitLike {
  rest: {
    issues: {
      listLabelsOnIssue: (params: {
        owner: string
        repo: string
        issue_number: number
      }) => Promise<{ data: Array<{ name: string }> }>
      addLabels: (params: {
        owner: string
        repo: string
        issue_number: number
        labels: string[]
      }) => Promise<unknown>
      removeLabel: (params: {
        owner: string
        repo: string
        issue_number: number
        name: string
      }) => Promise<unknown>
    }
    repos: {
      getLabel: (params: {
        owner: string
        repo: string
        name: string
      }) => Promise<unknown>
      createLabel: (params: {
        owner: string
        repo: string
        name: string
        color: string
        description: string
      }) => Promise<unknown>
    }
  }
}

/**
 * Fetch label names for an issue from GitHub.
 */
async function fetchLabelNames(
  octokit: OctokitLike,
  owner: string,
  repo: string,
  issueNumber: number
): Promise<string[]> {
  const response = await octokit.rest.issues.listLabelsOnIssue({
    owner,
    repo,
    issue_number: issueNumber,
  })
  return response.data.map((l) => l.name)
}

export function createStateManager(): StateManager {
  return {
    async getCurrentState(
      octokit: OctokitLike,
      owner: string,
      repo: string,
      issueNumber: number
    ): Promise<AgentState> {
      const labelNames = await fetchLabelNames(octokit, owner, repo, issueNumber)
      return (getStateFromLabels(labelNames) as AgentState) ?? null
    },

    async transition(
      octokit: OctokitLike,
      owner: string,
      repo: string,
      issueNumber: number,
      trigger: Trigger
    ): Promise<TransitionResult> {
      // 1. Fetch current labels
      const labelNames = await fetchLabelNames(octokit, owner, repo, issueNumber)

      // 2. Determine current state
      const currentState = (getStateFromLabels(labelNames) as AgentState) ?? null

      // 3. Validate transition
      const result = getNextState(currentState, trigger)

      if (!result.valid) {
        return result
      }

      // 4. If valid: remove old state label, add new state label
      // Remove old state label (if present)
      if (currentState !== null) {
        try {
          await octokit.rest.issues.removeLabel({
            owner,
            repo,
            issue_number: issueNumber,
            name: currentState,
          })
        } catch {
          // Label may already be removed; ignore 404s
        }
      }

      // Add new state label (if the target is not null)
      if (result.to !== null) {
        await octokit.rest.issues.addLabels({
          owner,
          repo,
          issue_number: issueNumber,
          labels: [result.to],
        })
      }

      return result
    },

    async ensureLabel(
      octokit: OctokitLike,
      owner: string,
      repo: string,
      label: LabelDefinition
    ): Promise<void> {
      try {
        await octokit.rest.repos.getLabel({
          owner,
          repo,
          name: label.name,
        })
        // Label already exists
      } catch {
        // Label does not exist -- create it
        await octokit.rest.repos.createLabel({
          owner,
          repo,
          name: label.name,
          color: label.color,
          description: label.description,
        })
      }
    },

    async ensureAllLabels(
      octokit: OctokitLike,
      owner: string,
      repo: string
    ): Promise<void> {
      for (const label of ALL_LABELS) {
        await this.ensureLabel(octokit, owner, repo, label)
      }
    },
  }
}
