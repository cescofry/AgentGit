export interface PermissionCheck {
  name: string
  required: boolean
  status: "ok" | "missing" | "error"
  details?: string
}

export interface PermissionCheckResult {
  permissions: PermissionCheck[]
  allPassed: boolean
}

const REQUIRED_PERMISSIONS: Array<{ name: string; access: string }> = [
  { name: "issues", access: "write" },
  { name: "pull_requests", access: "write" },
  { name: "contents", access: "write" },
  { name: "metadata", access: "read" },
]

const WRITE_SATISFIES_READ = true

function accessSatisfied(required: string, actual: string): boolean {
  if (required === actual) return true
  if (required === "read" && actual === "write" && WRITE_SATISFIES_READ) return true
  return false
}

/**
 * Verify the GitHub App installation has required permissions.
 * Webhook event subscriptions are no longer checked since AgentGit
 * uses outbound polling instead of inbound webhooks.
 */
export async function checkPermissions(
  octokit: any,
  owner: string,
  repo: string,
  installationId?: number,
): Promise<PermissionCheckResult> {
  const permissions: PermissionCheck[] = []

  let appPermissions: Record<string, string> = {}

  try {
    if (installationId) {
      const { data } = await octokit.rest.apps.getInstallation({
        installation_id: installationId,
      })
      appPermissions = data.permissions ?? {}
    } else {
      const { data } = await octokit.rest.apps.getAuthenticated()
      appPermissions = data.permissions ?? {}
    }
  } catch (err: any) {
    // If we can't fetch app info, mark everything as error
    for (const perm of REQUIRED_PERMISSIONS) {
      permissions.push({
        name: perm.name,
        required: true,
        status: "error",
        details: `Could not verify: ${err.message}`,
      })
    }
    return { permissions, allPassed: false }
  }

  // Check permissions
  for (const req of REQUIRED_PERMISSIONS) {
    const actual = appPermissions[req.name]
    if (!actual) {
      permissions.push({
        name: req.name,
        required: true,
        status: "missing",
        details: `Permission "${req.name}" not granted. Required: ${req.access}.`,
      })
    } else if (!accessSatisfied(req.access, actual)) {
      permissions.push({
        name: req.name,
        required: true,
        status: "missing",
        details: `Permission "${req.name}" is "${actual}" but "${req.access}" is required.`,
      })
    } else {
      permissions.push({
        name: req.name,
        required: true,
        status: "ok",
        details: `${actual} access granted.`,
      })
    }
  }

  const allPassed = permissions.every((p) => p.status === "ok")

  return { permissions, allPassed }
}
