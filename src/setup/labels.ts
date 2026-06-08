import { LabelDefinition, ALL_LABELS } from "../state/labels"

export interface LabelProvisionResult {
  created: string[]
  existing: string[]
  errors: string[]
}

/**
 * Create all missing agent:* labels on a repository.
 * For each label, tries to fetch it first. If 404, creates it.
 * Tracks created vs existing vs errors.
 */
export async function provisionLabels(
  octokit: any,
  owner: string,
  repo: string,
  labels?: LabelDefinition[],
): Promise<LabelProvisionResult> {
  const targetLabels = labels ?? ALL_LABELS
  const result: LabelProvisionResult = {
    created: [],
    existing: [],
    errors: [],
  }

  for (const label of targetLabels) {
    try {
      await octokit.rest.issues.getLabel({
        owner,
        repo,
        name: label.name,
      })
      result.existing.push(label.name)
    } catch (err: any) {
      if (err.status === 404) {
        try {
          await octokit.rest.issues.createLabel({
            owner,
            repo,
            name: label.name,
            color: label.color,
            description: label.description,
          })
          result.created.push(label.name)
        } catch (createErr: any) {
          result.errors.push(`Failed to create label "${label.name}": ${createErr.message}`)
        }
      } else {
        result.errors.push(`Failed to check label "${label.name}": ${err.message}`)
      }
    }
  }

  return result
}
