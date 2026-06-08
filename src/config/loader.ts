import * as yaml from "js-yaml"
import * as fs from "fs"
import * as path from "path"
import { AgentGitConfig, DEFAULT_CONFIG } from "./defaults"
import { validateConfig } from "./schema"

// ── Config file paths to try, in priority order ──

const CONFIG_PATHS = [".agentGit/config.yml", ".github/agentgit.yml"]

// ── Interfaces ──

export interface LoadConfigResult {
  config: AgentGitConfig
  source: string
  warnings: string[]
}

// ── Deep merge utility ──

/**
 * Deep-merge two objects. Values from `override` take precedence over `base`.
 * Arrays are replaced entirely (not concatenated).
 * Only plain objects are recursively merged.
 */
function deepMerge(base: any, override: any): any {
  const result = { ...base }

  for (const key of Object.keys(override)) {
    const baseVal = base[key]
    const overrideVal = override[key]

    if (
      isPlainObject(baseVal) &&
      isPlainObject(overrideVal)
    ) {
      result[key] = deepMerge(baseVal, overrideVal)
    } else {
      result[key] = overrideVal
    }
  }

  return result
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// ── GitHub file fetching ──

/**
 * Fetch a file's content from a GitHub repo using Octokit.
 * Returns the decoded UTF-8 string content, or null if not found.
 */
async function fetchFileFromGitHub(
  octokit: any,
  owner: string,
  repo: string,
  filePath: string,
  ref?: string,
): Promise<string | null> {
  try {
    const params: Record<string, string> = { owner, repo, path: filePath }
    if (ref) {
      params.ref = ref
    }
    const response = await octokit.rest.repos.getContent(params)

    // GitHub returns base64-encoded content for files
    if (
      response.data &&
      typeof response.data.content === "string" &&
      response.data.encoding === "base64"
    ) {
      return Buffer.from(response.data.content, "base64").toString("utf-8")
    }

    return null
  } catch (err: any) {
    // 404 = file not found, which is expected
    if (err.status === 404) {
      return null
    }
    throw err
  }
}

/**
 * Read a file from the local filesystem.
 * Returns the UTF-8 string content, or null if not found.
 */
function readLocalFile(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf-8")
  } catch {
    return null
  }
}

// ── Public API ──

/**
 * Merge user config with defaults (user values override defaults).
 * Performs a deep merge: nested objects are merged recursively,
 * arrays and scalars from userConfig replace those in defaults.
 */
export function mergeConfig(
  userConfig: Partial<AgentGitConfig>,
  defaults: AgentGitConfig,
): AgentGitConfig {
  return deepMerge(defaults, userConfig) as AgentGitConfig
}

/**
 * Load config from the repository. Tries .agentGit/config.yml first,
 * falls back to .github/agentgit.yml, then uses defaults.
 *
 * @param octokit   - GitHub API client for fetching from the repo. Pass null for local loading.
 * @param owner     - Repository owner
 * @param repo      - Repository name
 * @param ref       - Branch/ref, defaults to repo default branch
 * @param localPath - Base path for local file system loading (used when octokit is null)
 * @returns The resolved config, source indication, and any warnings
 */
export async function loadConfig(
  octokit: any | null,
  owner: string,
  repo: string,
  ref?: string,
  localPath?: string,
): Promise<LoadConfigResult> {
  let rawContent: string | null = null
  let source = "defaults"

  // Try each config path in priority order
  for (const configPath of CONFIG_PATHS) {
    if (octokit) {
      rawContent = await fetchFileFromGitHub(octokit, owner, repo, configPath, ref)
    } else if (localPath) {
      const fullPath = path.join(localPath, configPath)
      rawContent = readLocalFile(fullPath)
    }

    if (rawContent !== null) {
      source = configPath
      break
    }
  }

  // If no config file found, return defaults
  if (rawContent === null) {
    return {
      config: { ...DEFAULT_CONFIG },
      source: "defaults",
      warnings: [],
    }
  }

  // Parse YAML
  let parsed: any
  try {
    parsed = yaml.load(rawContent)
  } catch (err: any) {
    return {
      config: { ...DEFAULT_CONFIG },
      source,
      warnings: [`Failed to parse YAML from ${source}: ${err.message}. Using defaults.`],
    }
  }

  // Handle empty YAML file
  if (!parsed || typeof parsed !== "object") {
    return {
      config: { ...DEFAULT_CONFIG },
      source,
      warnings: [`${source} is empty or not an object. Using defaults.`],
    }
  }

  // Validate
  const validation = validateConfig(parsed)
  const warnings = [...validation.warnings]

  if (!validation.valid) {
    return {
      config: { ...DEFAULT_CONFIG },
      source,
      warnings: [
        ...validation.errors.map((e) => `Validation error in ${source}: ${e}`),
        ...validation.warnings,
        "Using defaults due to validation errors.",
      ],
    }
  }

  // Merge with defaults
  const merged = mergeConfig(parsed, DEFAULT_CONFIG)

  return {
    config: merged,
    source,
    warnings,
  }
}
