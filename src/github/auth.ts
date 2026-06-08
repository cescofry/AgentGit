// ── Permission types ──

/** GitHub collaborator permission levels, ordered highest to lowest. */
export type GitHubPermission = "admin" | "maintain" | "write" | "triage" | "read"

/**
 * Numeric weight for each permission level.
 * Higher number = more privilege.
 */
const PERMISSION_RANK: Record<GitHubPermission, number> = {
  admin: 5,
  maintain: 4,
  write: 3,
  triage: 2,
  read: 1,
}

// ── Command categories ──

/** Commands that require full admin/maintain permission (no delegation). */
export const ADMIN_ONLY_COMMANDS = ["delegate", "undelegate", "stop"] as const

/** Commands that can be delegated to other users. */
export const DELEGATABLE_COMMANDS = ["plan", "revise", "approve", "run", "retry"] as const

/** Commands available to anyone without authentication. */
export const PUBLIC_COMMANDS = ["status", "delegates", "security-status"] as const

/** Security commands: admin or security_admins only, cannot be delegated. */
export const SECURITY_COMMANDS = ["unlock-security", "close-unsafe"] as const

// ── Interfaces ──

export interface AuthorizationContext {
  senderLogin: string
  repoOwner: string
  repoName: string
  issueNumber: number
  /** Permission levels that grant direct access, default ["admin", "maintain"]. */
  requiredPermissions: GitHubPermission[]
  /** Users explicitly allowed regardless of GitHub permission. */
  allowedUsers: string[]
  /** Users allowed to run security commands. */
  securityAdmins: string[]
  /** Minimum permission a user must have to be delegated to. Default "write". */
  minDelegatePermission: GitHubPermission
}

export interface AuthorizationResult {
  authorized: boolean
  reason: string
  via: "permission" | "allowlist" | "delegation" | "public" | "rejected"
}

// ── Helper sets for O(1) lookup ──

const adminOnlySet = new Set<string>(ADMIN_ONLY_COMMANDS)
const delegatableSet = new Set<string>(DELEGATABLE_COMMANDS)
const publicSet = new Set<string>(PUBLIC_COMMANDS)
const securitySet = new Set<string>(SECURITY_COMMANDS)

// ── Functions ──

/**
 * Check whether `actual` permission is at least as privileged as `required`.
 *
 * @example
 *   permissionAtLeast("admin", "write")  // true
 *   permissionAtLeast("read", "write")   // false
 *   permissionAtLeast("write", "write")  // true
 */
export function permissionAtLeast(
  actual: GitHubPermission,
  required: GitHubPermission,
): boolean {
  return PERMISSION_RANK[actual] >= PERMISSION_RANK[required]
}

/**
 * Fetch the permission level a user has on a repository via the GitHub API.
 *
 * Wraps: GET /repos/{owner}/{repo}/collaborators/{username}/permission
 *
 * @param octokit - Any object with a `rest.repos.getCollaboratorPermissionLevel` method
 * @param owner   - Repository owner (org or user)
 * @param repo    - Repository name
 * @param username - GitHub login to check
 * @returns The user's permission level
 */
export async function getPermissionLevel(
  octokit: any,
  owner: string,
  repo: string,
  username: string,
): Promise<GitHubPermission> {
  const response = await octokit.rest.repos.getCollaboratorPermissionLevel({
    owner,
    repo,
    username,
  })

  const permission = response.data.permission as string

  // GitHub returns "admin" | "write" | "read" | "none" for the classic model,
  // and additionally "maintain" | "triage" for fine-grained permissions.
  // Map "none" to "read" (lowest recognized level).
  if (permission === "none") {
    return "read"
  }

  if (permission in PERMISSION_RANK) {
    return permission as GitHubPermission
  }

  // Fallback for unexpected values
  return "read"
}

/**
 * Main authorization check for an `/agent` command.
 *
 * Flow:
 * 1. Public commands -> always authorized.
 * 2. Sender in allowedUsers -> authorized via allowlist.
 * 3. Check GitHub permission level against requiredPermissions.
 * 4. Security commands -> only if sender is in securityAdmins.
 * 5. Admin-only commands -> reject (no delegation for these).
 * 6. Delegatable commands -> check getDelegations callback (Phase 4 hook).
 * 7. Reject with explanation.
 *
 * @param octokit        - GitHub API client (or mock)
 * @param command        - The action string (lowercase)
 * @param context        - Authorization context with user, repo, and config info
 * @param getDelegations - Optional callback to retrieve delegations for an issue (Phase 4)
 * @returns AuthorizationResult indicating whether access is granted
 */
export async function isAuthorized(
  octokit: any,
  command: string,
  context: AuthorizationContext,
  getDelegations?: (issueNumber: number) => Promise<any[]>,
): Promise<AuthorizationResult> {
  // 1. Public commands are always authorized
  if (publicSet.has(command)) {
    return {
      authorized: true,
      reason: `\`${command}\` is a public command available to everyone.`,
      via: "public",
    }
  }

  // 2. Allowlist check (case-insensitive comparison)
  const senderLower = context.senderLogin.toLowerCase()
  const isAllowlisted = context.allowedUsers.some(
    (u) => u.toLowerCase() === senderLower,
  )
  if (isAllowlisted) {
    return {
      authorized: true,
      reason: `User \`${context.senderLogin}\` is in the allowed users list.`,
      via: "allowlist",
    }
  }

  // 3. Check GitHub permission level
  const userPermission = await getPermissionLevel(
    octokit,
    context.repoOwner,
    context.repoName,
    context.senderLogin,
  )

  const hasRequiredPermission = context.requiredPermissions.some((required) =>
    permissionAtLeast(userPermission, required),
  )

  if (hasRequiredPermission) {
    return {
      authorized: true,
      reason: `User \`${context.senderLogin}\` has \`${userPermission}\` permission on \`${context.repoOwner}/${context.repoName}\`.`,
      via: "permission",
    }
  }

  // 4. Security commands: only security admins (beyond the checks above)
  if (securitySet.has(command)) {
    const isSecurityAdmin = context.securityAdmins.some(
      (u) => u.toLowerCase() === senderLower,
    )
    if (isSecurityAdmin) {
      return {
        authorized: true,
        reason: `User \`${context.senderLogin}\` is a security admin.`,
        via: "permission",
      }
    }
    return {
      authorized: false,
      reason: `\`${command}\` requires admin permission or security admin role. User \`${context.senderLogin}\` has \`${userPermission}\` permission.`,
      via: "rejected",
    }
  }

  // 5. Admin-only commands: no delegation fallback
  if (adminOnlySet.has(command)) {
    return {
      authorized: false,
      reason: `\`${command}\` requires ${context.requiredPermissions.join(" or ")} permission. User \`${context.senderLogin}\` has \`${userPermission}\` permission and this command cannot be delegated.`,
      via: "rejected",
    }
  }

  // 6. Delegatable commands: check delegation callback if provided
  if (delegatableSet.has(command) && getDelegations) {
    const delegations = await getDelegations(context.issueNumber)
    const isDelegated = delegations.some(
      (d: any) =>
        d.username.toLowerCase() === senderLower &&
        (d.command === command || d.command === "*"),
    )
    if (isDelegated) {
      return {
        authorized: true,
        reason: `User \`${context.senderLogin}\` is delegated for \`${command}\` on issue #${context.issueNumber}.`,
        via: "delegation",
      }
    }
  }

  // 7. Reject
  return {
    authorized: false,
    reason: `User \`${context.senderLogin}\` has \`${userPermission}\` permission on \`${context.repoOwner}/${context.repoName}\`. Required: ${context.requiredPermissions.join(" or ")}. Use \`/agent status\` to check your access.`,
    via: "rejected",
  }
}
