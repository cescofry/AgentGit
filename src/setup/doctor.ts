import { execSync } from "child_process"
import * as fs from "fs"
import { checkPermissions } from "./permissions"
import { provisionLabels } from "./labels"
import { validateEnv } from "../utils/env"

export interface DoctorResult {
  sections: Array<{
    name: string
    checks: Array<{ name: string; status: "ok" | "warn" | "error"; details?: string }>
  }>
  totalPassed: number
  totalWarnings: number
  totalFailed: number
  exitCode: 0 | 1 | 2 // 0=all pass, 1=failures, 2=warnings only
}

function tryExec(cmd: string): string | null {
  try {
    return execSync(cmd, { encoding: "utf-8", timeout: 5000 }).trim()
  } catch {
    return null
  }
}

function parseVersion(versionStr: string): [number, number, number] | null {
  const match = versionStr.match(/(\d+)\.(\d+)\.(\d+)/)
  if (!match) return null
  return [parseInt(match[1], 10), parseInt(match[2], 10), parseInt(match[3], 10)]
}

function meetsMinVersion(
  actual: [number, number, number],
  min: [number, number, number],
): boolean {
  if (actual[0] !== min[0]) return actual[0] > min[0]
  if (actual[1] !== min[1]) return actual[1] > min[1]
  return actual[2] >= min[2]
}

/**
 * Run all health checks across sections:
 * - Server Environment
 * - Repository (if localPath provided)
 * - GitHub App (if octokit provided)
 * - Connectivity
 */
export async function runDoctor(options: {
  octokit?: any
  owner?: string
  repo?: string
  localPath?: string
}): Promise<DoctorResult> {
  const sections: DoctorResult["sections"] = []

  // Section 1: Server Environment
  const envChecks: DoctorResult["sections"][0]["checks"] = []

  // Node.js version
  const nodeVersion = parseVersion(process.version)
  if (nodeVersion && meetsMinVersion(nodeVersion, [18, 0, 0])) {
    envChecks.push({ name: "Node.js >= 18", status: "ok", details: process.version })
  } else {
    envChecks.push({
      name: "Node.js >= 18",
      status: "error",
      details: `Found ${process.version}, need >= 18.0.0`,
    })
  }

  // Git version
  const gitOutput = tryExec("git --version")
  if (gitOutput) {
    const gitVersion = parseVersion(gitOutput)
    if (gitVersion && meetsMinVersion(gitVersion, [2, 30, 0])) {
      envChecks.push({ name: "Git >= 2.30", status: "ok", details: gitOutput })
    } else {
      envChecks.push({
        name: "Git >= 2.30",
        status: "error",
        details: `Found ${gitOutput}, need >= 2.30.0`,
      })
    }
  } else {
    envChecks.push({ name: "Git >= 2.30", status: "error", details: "Git not found" })
  }

  // Env vars
  const envResult = validateEnv(true)
  if (envResult.missing.length === 0) {
    envChecks.push({ name: "Environment variables", status: "ok" })
  } else {
    envChecks.push({
      name: "Environment variables",
      status: "error",
      details: `Missing: ${envResult.missing.join(", ")}`,
    })
  }

  // Docker (optional)
  const dockerOutput = tryExec("docker --version")
  if (dockerOutput) {
    envChecks.push({ name: "Docker", status: "ok", details: dockerOutput })
  } else {
    envChecks.push({ name: "Docker", status: "warn", details: "Not installed" })
  }

  // OpenCode (optional)
  const opencodeOutput = tryExec("opencode --version")
  if (opencodeOutput) {
    envChecks.push({ name: "OpenCode", status: "ok", details: opencodeOutput })
  } else {
    envChecks.push({ name: "OpenCode", status: "warn", details: "Not installed" })
  }

  sections.push({ name: "Server Environment", checks: envChecks })

  // Section 2: Repository
  if (options.localPath) {
    const repoChecks: DoctorResult["sections"][0]["checks"] = []

    // Check .agentGit directory exists
    const agentGitDir = `${options.localPath}/.agentGit`
    if (fs.existsSync(agentGitDir)) {
      repoChecks.push({ name: ".agentGit/ directory", status: "ok" })
    } else {
      repoChecks.push({
        name: ".agentGit/ directory",
        status: "error",
        details: "Not found. Run 'agentgit setup repo' first.",
      })
    }

    // Check config file exists
    const configPath = `${options.localPath}/.agentGit/config.yml`
    if (fs.existsSync(configPath)) {
      repoChecks.push({ name: ".agentGit/config.yml", status: "ok" })
    } else {
      repoChecks.push({
        name: ".agentGit/config.yml",
        status: "error",
        details: "Not found. Run 'agentgit setup repo' first.",
      })
    }

    // Check it's a git repo
    const gitDir = `${options.localPath}/.git`
    if (fs.existsSync(gitDir)) {
      repoChecks.push({ name: "Git repository", status: "ok" })
    } else {
      repoChecks.push({
        name: "Git repository",
        status: "error",
        details: "Not a git repository.",
      })
    }

    sections.push({ name: "Repository", checks: repoChecks })
  }

  // Section 3: GitHub App
  if (options.octokit && options.owner && options.repo) {
    const appChecks: DoctorResult["sections"][0]["checks"] = []

    try {
      await options.octokit.rest.apps.getAuthenticated()
      appChecks.push({ name: "GitHub App authentication", status: "ok" })
    } catch (err: any) {
      appChecks.push({
        name: "GitHub App authentication",
        status: "error",
        details: err.message,
      })
    }

    try {
      const permResult = await checkPermissions(
        options.octokit,
        options.owner,
        options.repo,
      )
      if (permResult.allPassed) {
        appChecks.push({ name: "App permissions", status: "ok" })
      } else {
        const missingPerms = permResult.permissions.filter((p) => p.status !== "ok")
        if (missingPerms.length > 0) {
          appChecks.push({
            name: "App permissions",
            status: "error",
            details: `Missing: ${missingPerms.map((p) => p.name).join(", ")}`,
          })
        } else {
          appChecks.push({ name: "App permissions", status: "ok" })
        }
      }
    } catch (err: any) {
      appChecks.push({
        name: "App permissions",
        status: "error",
        details: err.message,
      })
    }

    // Check label provisioning
    try {
      const { data: labels } = await options.octokit.rest.issues.listLabelsForRepo({
        owner: options.owner,
        repo: options.repo,
      })
      const labelNames = new Set(labels.map((l: any) => l.name)) as Set<string>
      const agentLabels = Array.from(labelNames).filter((n) =>
        n.startsWith("agent:"),
      )
      if (agentLabels.length > 0) {
        appChecks.push({
          name: "Agent labels",
          status: "ok",
          details: `${agentLabels.length} agent labels found.`,
        })
      } else {
        appChecks.push({
          name: "Agent labels",
          status: "warn",
          details: "No agent:* labels found. Run 'agentgit setup repo'.",
        })
      }
    } catch (err: any) {
      appChecks.push({
        name: "Agent labels",
        status: "error",
        details: err.message,
      })
    }

    sections.push({ name: "GitHub App", checks: appChecks })
  }

  // Section 4: Connectivity
  const connectivityChecks: DoctorResult["sections"][0]["checks"] = []

  if (options.octokit) {
    try {
      await options.octokit.rest.meta.get()
      connectivityChecks.push({ name: "GitHub API reachable", status: "ok" })
    } catch (err: any) {
      connectivityChecks.push({
        name: "GitHub API reachable",
        status: "error",
        details: err.message,
      })
    }
  } else {
    connectivityChecks.push({
      name: "GitHub API reachable",
      status: "warn",
      details: "No octokit provided, skipping connectivity check.",
    })
  }

  sections.push({ name: "Connectivity", checks: connectivityChecks })

  // Compute totals
  let totalPassed = 0
  let totalWarnings = 0
  let totalFailed = 0

  for (const section of sections) {
    for (const check of section.checks) {
      if (check.status === "ok") totalPassed++
      else if (check.status === "warn") totalWarnings++
      else totalFailed++
    }
  }

  let exitCode: 0 | 1 | 2
  if (totalFailed > 0) {
    exitCode = 1
  } else if (totalWarnings > 0) {
    exitCode = 2
  } else {
    exitCode = 0
  }

  return { sections, totalPassed, totalWarnings, totalFailed, exitCode }
}
