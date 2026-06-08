import * as fs from "fs"
import * as path from "path"
import type { AgentGitConfig } from "../config/defaults"
import { DEFAULT_CONFIG } from "../config/defaults"
import { provisionLabels } from "./labels"
import { checkPermissions } from "./permissions"

export interface RepoSetupResult {
  success: boolean
  steps: Array<{ step: string; status: "ok" | "skipped" | "error"; details?: string }>
}

/**
 * Run the repo setup flow:
 * 1. Validate GitHub App credentials
 * 2. Verify bot permissions
 * 3. Create missing agent:* labels
 * 4. Generate .agentGit/ directory structure
 * 5. Generate .agentGit/config.yml
 */
export async function setupRepo(options: {
  octokit: any
  owner: string
  repo: string
  configOverrides?: Partial<AgentGitConfig>
  dryRun?: boolean
}): Promise<RepoSetupResult> {
  const { octokit, owner, repo, configOverrides, dryRun = false } = options
  const steps: RepoSetupResult["steps"] = []

  // Step 1: Validate GitHub App credentials
  try {
    await octokit.rest.apps.getAuthenticated()
    steps.push({ step: "Validate GitHub App credentials", status: "ok" })
  } catch (err: any) {
    steps.push({
      step: "Validate GitHub App credentials",
      status: "error",
      details: err.message,
    })
    return { success: false, steps }
  }

  // Step 2: Verify bot permissions
  try {
    const permResult = await checkPermissions(octokit, owner, repo)
    if (permResult.allPassed) {
      steps.push({ step: "Verify bot permissions", status: "ok" })
    } else {
      const missing = permResult.permissions.filter((p) => p.status !== "ok")
      steps.push({
        step: "Verify bot permissions",
        status: "error",
        details: `Missing: ${missing.map((m) => m.name).join(", ")}`,
      })
      return { success: false, steps }
    }
  } catch (err: any) {
    steps.push({
      step: "Verify bot permissions",
      status: "error",
      details: err.message,
    })
    return { success: false, steps }
  }

  // Step 3: Create missing agent:* labels
  if (dryRun) {
    steps.push({
      step: "Create missing agent:* labels",
      status: "skipped",
      details: "Dry run",
    })
  } else {
    try {
      const labelResult = await provisionLabels(octokit, owner, repo)
      if (labelResult.errors.length > 0) {
        steps.push({
          step: "Create missing agent:* labels",
          status: "error",
          details: labelResult.errors.join("; "),
        })
      } else {
        steps.push({
          step: "Create missing agent:* labels",
          status: "ok",
          details: `Created ${labelResult.created.length}, existing ${labelResult.existing.length}`,
        })
      }
    } catch (err: any) {
      steps.push({
        step: "Create missing agent:* labels",
        status: "error",
        details: err.message,
      })
    }
  }

  // Step 4: Generate .agentGit/ directory structure
  const agentGitDir = path.join(process.cwd(), ".agentGit")
  if (dryRun) {
    steps.push({
      step: "Generate .agentGit/ directory",
      status: "skipped",
      details: "Dry run",
    })
  } else {
    try {
      if (!fs.existsSync(agentGitDir)) {
        fs.mkdirSync(agentGitDir, { recursive: true })
        steps.push({ step: "Generate .agentGit/ directory", status: "ok", details: "Created" })
      } else {
        steps.push({ step: "Generate .agentGit/ directory", status: "ok", details: "Already exists" })
      }
    } catch (err: any) {
      steps.push({
        step: "Generate .agentGit/ directory",
        status: "error",
        details: err.message,
      })
    }
  }

  // Step 5: Generate .agentGit/config.yml
  const configPath = path.join(agentGitDir, "config.yml")
  if (dryRun) {
    steps.push({
      step: "Generate .agentGit/config.yml",
      status: "skipped",
      details: "Dry run",
    })
  } else {
    try {
      const config = { ...DEFAULT_CONFIG, ...configOverrides }
      const yamlContent = generateConfigYaml(config)
      fs.writeFileSync(configPath, yamlContent, "utf-8")
      steps.push({ step: "Generate .agentGit/config.yml", status: "ok" })
    } catch (err: any) {
      steps.push({
        step: "Generate .agentGit/config.yml",
        status: "error",
        details: err.message,
      })
    }
  }

  const hasError = steps.some((s) => s.status === "error")
  return { success: !hasError, steps }
}

/**
 * Generate a simple YAML-like config string from a config object.
 * Uses JSON serialization with 2-space indent for simplicity.
 */
function generateConfigYaml(config: AgentGitConfig): string {
  return JSON.stringify(config, null, 2)
}
