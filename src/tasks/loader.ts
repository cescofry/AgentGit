/**
 * Task definition types and loading functions.
 *
 * Types mirror the YAML structure found in:
 *   - src/tasks/defaults/*.yml  (built-in tasks)
 *   - .agentGit/tasks/*.yml     (user overrides)
 *
 * Loading functions resolve task definitions from user overrides first,
 * then fall back to built-in defaults.
 */

import * as yaml from "js-yaml"
import * as fs from "fs"
import * as path from "path"

// ── Types ──

export type OnFailure = "block" | "lock-security" | "warn" | "skip"

export interface PhaseDefinition {
  /** Unique name for this phase within the task. */
  name: string
  /** Name of the skill to execute. */
  skill: string
  /** Human-readable description of what this phase does. */
  description?: string
  /**
   * Input mapping for the skill.
   * Values may be literal strings or $-prefixed references
   * (e.g. "$issue", "$config.execution.harness", "$phases.classify-issue.result.task_type").
   */
  inputs?: Record<string, string>
  /** Behavior on phase failure. Defaults to "block". */
  on_failure?: OnFailure
  /** Whether the task fails if this phase fails, regardless of on_failure. Defaults to false. */
  required?: boolean
}

export interface TaskDefinition {
  /** Unique name for this task (e.g. "pre-plan", "plan", "build", "post-build"). */
  name: string
  /** Human-readable description of the task. */
  description: string
  /** Ordered list of phases to execute. */
  phases: PhaseDefinition[]
}

// ── Constants ──

/** Names of the built-in default tasks. */
const DEFAULT_TASK_NAMES = ["pre-plan", "plan", "build", "post-build"]

/** Path within a repo for user task overrides. */
const USER_TASKS_DIR = ".agentGit/tasks"

/** Directory containing built-in default task YAML files. */
const DEFAULTS_DIR = path.join(__dirname, "defaults")

// ── Helpers ──

/**
 * Parse a YAML string into a TaskDefinition.
 * Returns null if parsing fails or the result is not a valid task shape.
 */
function parseTaskYaml(content: string): TaskDefinition | null {
  try {
    const parsed = yaml.load(content) as any
    if (!parsed || typeof parsed !== "object") {
      return null
    }
    if (typeof parsed.name !== "string" || !Array.isArray(parsed.phases)) {
      return null
    }

    return {
      name: parsed.name,
      description: parsed.description ?? "",
      phases: parsed.phases.map((p: any) => ({
        name: p.name,
        skill: p.skill,
        description: p.description,
        inputs: p.inputs,
        on_failure: p.on_failure,
        required: p.required,
      })),
    }
  } catch {
    return null
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

    if (response.data && response.data.content && response.data.encoding === "base64") {
      return Buffer.from(response.data.content, "base64").toString("utf-8")
    }

    return null
  } catch (err: any) {
    if (err.status === 404) {
      return null
    }
    throw err
  }
}

// ── Public API ──

/**
 * Load all default task definitions from the built-in defaults directory.
 *
 * Returns a Record keyed by task name (e.g., "pre-plan", "plan", "build", "post-build").
 */
export function loadDefaultTasks(): Record<string, TaskDefinition> {
  const tasks: Record<string, TaskDefinition> = {}

  for (const taskName of DEFAULT_TASK_NAMES) {
    const filePath = path.join(DEFAULTS_DIR, `${taskName}.yml`)
    const content = readLocalFile(filePath)

    if (content === null) {
      continue
    }

    const task = parseTaskYaml(content)
    if (task) {
      tasks[taskName] = task
    }
  }

  return tasks
}

/**
 * Load a task definition by name. Checks user override first, then built-in default.
 *
 * Resolution order:
 * 1. `.agentGit/tasks/<taskName>.yml` in the repo (via octokit or local fs)
 * 2. Built-in default from `src/tasks/defaults/<taskName>.yml`
 *
 * @param taskName  - Name of the task to load (e.g., "pre-plan", "plan")
 * @param octokit   - GitHub API client. Pass null for local filesystem loading.
 * @param owner     - Repository owner
 * @param repo      - Repository name
 * @param ref       - Branch/ref for GitHub API
 * @param localPath - Base path for local filesystem loading (used when octokit is null)
 * @returns The TaskDefinition, or null if not found anywhere
 */
export async function loadTaskDefinition(
  taskName: string,
  octokit: any | null,
  owner: string,
  repo: string,
  ref?: string,
  localPath?: string,
): Promise<TaskDefinition | null> {
  const userFilePath = `${USER_TASKS_DIR}/${taskName}.yml`

  // 1. Try user override
  let userContent: string | null = null

  if (octokit) {
    userContent = await fetchFileFromGitHub(octokit, owner, repo, userFilePath, ref)
  } else if (localPath) {
    const fullPath = path.join(localPath, userFilePath)
    userContent = readLocalFile(fullPath)
  }

  if (userContent !== null) {
    const task = parseTaskYaml(userContent)
    if (task) {
      return task
    }
  }

  // 2. Try built-in default
  const defaultFilePath = path.join(DEFAULTS_DIR, `${taskName}.yml`)
  const defaultContent = readLocalFile(defaultFilePath)

  if (defaultContent !== null) {
    return parseTaskYaml(defaultContent)
  }

  return null
}
