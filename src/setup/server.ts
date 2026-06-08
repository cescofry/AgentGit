import { execSync } from "child_process"
import { validateEnv } from "../utils/env"

export interface ServerSetupResult {
  success: boolean
  checks: Array<{ check: string; status: "ok" | "warn" | "error"; details?: string }>
}

/**
 * Parse a version string like "v18.17.0" or "2.39.1" into [major, minor, patch].
 */
function parseVersion(versionStr: string): [number, number, number] | null {
  const match = versionStr.match(/(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)]
}

/**
 * Check if version meets minimum requirement.
 */
function meetsMinVersion(
  actual: [number, number, number],
  min: [number, number, number],
): boolean {
  if (actual[0] !== min[0]) return actual[0] > min[0]
  if (actual[1] !== min[1]) return actual[1] > min[1]
  return actual[2] >= min[2]
}

/**
 * Try to run a shell command and return its stdout, or null on failure.
 */
function tryExec(cmd: string): string | null {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 5000 }).trim()
  } catch {
    return null
  }
}

/**
 * Validate server environment:
 * 1. Node.js >= 18
 * 2. Git >= 2.30
 * 3. Required env vars present
 * 4. Optional: Docker available
 * 5. Optional: OpenCode available
 */
export async function setupServer(): Promise<ServerSetupResult> {
  const checks: ServerSetupResult["checks"] = []

  // Check 1: Node.js >= 18
  const nodeVersion = parseVersion(process.version)
  if (!nodeVersion) {
    checks.push({
      check: "Node.js >= 18",
      status: "error",
      details: `Could not parse Node.js version: ${process.version}`,
    })
  } else if (!meetsMinVersion(nodeVersion, [18, 0, 0])) {
    checks.push({
      check: "Node.js >= 18",
      status: "error",
      details: `Node.js ${process.version} does not meet minimum v18.0.0.`,
    })
  } else {
    checks.push({
      check: "Node.js >= 18",
      status: "ok",
      details: `Node.js ${process.version}`,
    })
  }

  // Check 2: Git >= 2.30
  const gitVersionOutput = tryExec("git --version")
  if (!gitVersionOutput) {
    checks.push({
      check: "Git >= 2.30",
      status: "error",
      details: "Git is not installed or not found in PATH.",
    })
  } else {
    const gitVersion = parseVersion(gitVersionOutput)
    if (!gitVersion) {
      checks.push({
        check: "Git >= 2.30",
        status: "error",
        details: `Could not parse git version from: ${gitVersionOutput}`,
      })
    } else if (!meetsMinVersion(gitVersion, [2, 30, 0])) {
      checks.push({
        check: "Git >= 2.30",
        status: "error",
        details: `Git ${gitVersionOutput} does not meet minimum v2.30.0.`,
      })
    } else {
      checks.push({
        check: "Git >= 2.30",
        status: "ok",
        details: gitVersionOutput,
      })
    }
  }

  // Check 3: Required env vars
  const envResult = validateEnv(true)
  if (envResult.missing.length === 0) {
    checks.push({
      check: "Required environment variables",
      status: "ok",
      details: "All required variables are set.",
    })
  } else {
    checks.push({
      check: "Required environment variables",
      status: "error",
      details: `Missing: ${envResult.missing.join(", ")}`,
    })
  }

  // Check 4: Optional - Docker
  const dockerOutput = tryExec("docker --version")
  if (dockerOutput) {
    checks.push({
      check: "Docker (optional)",
      status: "ok",
      details: dockerOutput,
    })
  } else {
    checks.push({
      check: "Docker (optional)",
      status: "warn",
      details: "Docker is not installed. Container-based execution unavailable.",
    })
  }

  // Check 5: Optional - OpenCode
  const opencodeOutput = tryExec("opencode --version")
  if (opencodeOutput) {
    checks.push({
      check: "OpenCode (optional)",
      status: "ok",
      details: opencodeOutput,
    })
  } else {
    checks.push({
      check: "OpenCode (optional)",
      status: "warn",
      details: "OpenCode is not installed. AI harness unavailable.",
    })
  }

  const hasError = checks.some((c) => c.status === "error")
  return { success: !hasError, checks }
}
