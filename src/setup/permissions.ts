export interface PermissionCheck {
  name: string
  required: boolean
  status: "ok" | "missing" | "error"
  details?: string
}

export interface PermissionCheckResult {
  permissions: PermissionCheck[]
  webhookEvents: PermissionCheck[]
  allPassed: boolean
}

const REQUIRED_PERMISSIONS: Array<{ name: string; access: string }> = [
  { name: "issues", access: "write" },
  { name: "pull_requests", access: "write" },
  { name: "contents", access: "write" },
  { name: "metadata", access: "read" },
]

const REQUIRED_WEBHOOK_EVENTS: string[] = [
  "issues",
  "issue_comment",
  "pull_request",
  "pull_request_review",
  "label",
]

const WRITE_SATISFIES_READ = true

function accessSatisfied(required: string, actual: string): boolean {
  if (required === actual) return true
  if (required === "read" && actual === "write" && WRITE_SATISFIES_READ) return true
  return false
}

/**
 * Verify the GitHub App installation has required permissions and webhook events.
 * Uses the installation metadata endpoint when installationId is provided,
 * otherwise falls back to the authenticated app endpoint.
 */
export async function checkPermissions(
  octokit: any,
  owner: string,
  repo: string,
  installationId?: number,
): Promise<PermissionCheckResult> {
  const permissions: PermissionCheck[] = []
  const webhookEvents: PermissionCheck[] = []

  let appPermissions: Record<string, string> = {}
  let appEvents: string[] = []

  try {
    if (installationId) {
      const { data } = await octokit.rest.apps.getInstallation({
        installation_id: installationId,
      })
      appPermissions = data.permissions ?? {}
      appEvents = data.events ?? []
    } else {
      const { data } = await octokit.rest.apps.getAuthenticated()
      appPermissions = data.permissions ?? {}
      appEvents = data.events ?? []
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
    for (const event of REQUIRED_WEBHOOK_EVENTS) {
      webhookEvents.push({
        name: event,
        required: true,
        status: "error",
        details: `Could not verify: ${err.message}`,
      })
    }
    return { permissions, webhookEvents, allPassed: false }
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

  // Check webhook events
  const eventSet = new Set(appEvents)
  for (const event of REQUIRED_WEBHOOK_EVENTS) {
    if (eventSet.has(event)) {
      webhookEvents.push({
        name: event,
        required: true,
        status: "ok",
      })
    } else {
      webhookEvents.push({
        name: event,
        required: true,
        status: "missing",
        details: `Webhook event "${event}" is not subscribed.`,
      })
    }
  }

  const allPassed =
    permissions.every((p) => p.status === "ok") &&
    webhookEvents.every((e) => e.status === "ok")

  return { permissions, webhookEvents, allPassed }
}
