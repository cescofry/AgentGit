import type { AgentGitConfig } from "./defaults"

// ── Valid values for constrained fields ──

const VALID_PERMISSIONS = ["admin", "maintain", "write", "triage", "read"]

const VALID_HARNESS_VALUES = ["opencode", "pi"]

const VALID_DISALLOWED_CATEGORIES = [
  "credential_theft",
  "malware",
  "data_exfiltration",
  "abuse",
  "policy_bypass",
  "destructive_change",
]

// ── Validation result ──

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

// ── Helpers ──

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean"
}

function isString(value: unknown): value is string {
  return typeof value === "string"
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && !isNaN(value)
}

function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value)
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// ── Known top-level keys ──

const KNOWN_TOP_LEVEL_KEYS = new Set([
  "enabled",
  "ready_labels",
  "approval",
  "security",
  "task_types",
  "execution",
  "execution_environment",
])

// ── Main validator ──

/**
 * Validate a parsed config object against the expected AgentGitConfig schema.
 *
 * This validates the *user-provided* config values, not the merged config.
 * The config may be partial (missing fields are filled by mergeConfig with defaults).
 *
 * Returns { valid: true, errors: [], warnings: [] } when all present fields are valid.
 * Returns { valid: false, errors: [...], warnings: [...] } when any field has an invalid value.
 */
export function validateConfig(config: any): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (!isObject(config)) {
    errors.push("Config must be an object.")
    return { valid: false, errors, warnings }
  }

  // Warn on unknown top-level keys
  for (const key of Object.keys(config)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
      warnings.push(`Unknown top-level key: "${key}".`)
    }
  }

  // ── enabled ──
  if ("enabled" in config && !isBoolean(config.enabled)) {
    errors.push("`enabled` must be a boolean.")
  }

  // ── ready_labels ──
  if ("ready_labels" in config) {
    if (!isArray(config.ready_labels)) {
      errors.push("`ready_labels` must be an array of strings.")
    } else {
      for (const label of config.ready_labels) {
        if (!isString(label)) {
          errors.push("`ready_labels` must contain only strings.")
          break
        }
      }
    }
  }

  // ── approval ──
  if ("approval" in config) {
    if (!isObject(config.approval)) {
      errors.push("`approval` must be an object.")
    } else {
      const approval = config.approval as Record<string, unknown>

      if ("required_permissions" in approval) {
        if (!isArray(approval.required_permissions)) {
          errors.push("`approval.required_permissions` must be an array.")
        } else {
          for (const perm of approval.required_permissions) {
            if (!isString(perm) || !VALID_PERMISSIONS.includes(perm)) {
              errors.push(
                `Invalid permission in \`approval.required_permissions\`: "${perm}". ` +
                  `Valid values: ${VALID_PERMISSIONS.join(", ")}.`,
              )
            }
          }
        }
      }

      if ("allowed_users" in approval) {
        if (!isArray(approval.allowed_users)) {
          errors.push("`approval.allowed_users` must be an array of strings.")
        }
      }

      if ("delegation" in approval) {
        if (!isObject(approval.delegation)) {
          errors.push("`approval.delegation` must be an object.")
        } else {
          const delegation = approval.delegation as Record<string, unknown>

          if ("enabled" in delegation && !isBoolean(delegation.enabled)) {
            errors.push("`approval.delegation.enabled` must be a boolean.")
          }

          if (
            "min_delegator_permission" in delegation &&
            (!isString(delegation.min_delegator_permission) ||
              !VALID_PERMISSIONS.includes(delegation.min_delegator_permission))
          ) {
            errors.push(
              `Invalid \`approval.delegation.min_delegator_permission\`: "${delegation.min_delegator_permission}". ` +
                `Valid values: ${VALID_PERMISSIONS.join(", ")}.`,
            )
          }

          if (
            "min_delegate_permission" in delegation &&
            (!isString(delegation.min_delegate_permission) ||
              !VALID_PERMISSIONS.includes(delegation.min_delegate_permission))
          ) {
            errors.push(
              `Invalid \`approval.delegation.min_delegate_permission\`: "${delegation.min_delegate_permission}". ` +
                `Valid values: ${VALID_PERMISSIONS.join(", ")}.`,
            )
          }

          if (
            "allow_delegate_chaining" in delegation &&
            !isBoolean(delegation.allow_delegate_chaining)
          ) {
            errors.push(
              "`approval.delegation.allow_delegate_chaining` must be a boolean.",
            )
          }
        }
      }
    }
  }

  // ── security ──
  if ("security" in config) {
    if (!isObject(config.security)) {
      errors.push("`security` must be an object.")
    } else {
      const security = config.security as Record<string, unknown>

      if ("pre_plan_check" in security) {
        if (!isObject(security.pre_plan_check)) {
          errors.push("`security.pre_plan_check` must be an object.")
        } else {
          const preCheck = security.pre_plan_check as Record<string, unknown>

          if ("enabled" in preCheck && !isBoolean(preCheck.enabled)) {
            errors.push("`security.pre_plan_check.enabled` must be a boolean.")
          }
          if ("lock_on_unsafe" in preCheck && !isBoolean(preCheck.lock_on_unsafe)) {
            errors.push(
              "`security.pre_plan_check.lock_on_unsafe` must be a boolean.",
            )
          }
          if (
            "admin_unlock_required" in preCheck &&
            !isBoolean(preCheck.admin_unlock_required)
          ) {
            errors.push(
              "`security.pre_plan_check.admin_unlock_required` must be a boolean.",
            )
          }
        }
      }

      if ("security_admins" in security) {
        if (!isArray(security.security_admins)) {
          errors.push("`security.security_admins` must be an array of strings.")
        }
      }

      if ("disallowed_categories" in security) {
        if (!isArray(security.disallowed_categories)) {
          errors.push("`security.disallowed_categories` must be an array.")
        } else {
          for (const cat of security.disallowed_categories) {
            if (!isString(cat) || !VALID_DISALLOWED_CATEGORIES.includes(cat)) {
              errors.push(
                `Invalid category in \`security.disallowed_categories\`: "${cat}". ` +
                  `Valid values: ${VALID_DISALLOWED_CATEGORIES.join(", ")}.`,
              )
            }
          }
        }
      }
    }
  }

  // ── task_types ──
  if ("task_types" in config) {
    if (!isObject(config.task_types)) {
      errors.push("`task_types` must be an object.")
    } else {
      const taskTypes = config.task_types as Record<string, unknown>
      for (const [name, def] of Object.entries(taskTypes)) {
        if (!isObject(def)) {
          errors.push(`\`task_types.${name}\` must be an object with a \`labels\` array.`)
        } else {
          const typeDef = def as Record<string, unknown>
          if (!("labels" in typeDef) || !isArray(typeDef.labels)) {
            errors.push(`\`task_types.${name}.labels\` must be an array of strings.`)
          }
        }
      }
    }
  }

  // ── execution ──
  if ("execution" in config) {
    if (!isObject(config.execution)) {
      errors.push("`execution` must be an object.")
    } else {
      const execution = config.execution as Record<string, unknown>

      if (
        "harness" in execution &&
        (!isString(execution.harness) ||
          !VALID_HARNESS_VALUES.includes(execution.harness))
      ) {
        errors.push(
          `Invalid \`execution.harness\`: "${execution.harness}". Must be one of: ${VALID_HARNESS_VALUES.join(", ")}.`,
        )
      }

      if ("model" in execution && !isString(execution.model)) {
        errors.push("`execution.model` must be a string.")
      }

      if ("plan_model" in execution && !isString(execution.plan_model)) {
        errors.push("`execution.plan_model` must be a string.")
      }

      if ("test_command" in execution && !isString(execution.test_command)) {
        errors.push("`execution.test_command` must be a string.")
      }

      if ("max_runtime_minutes" in execution) {
        if (!isNumber(execution.max_runtime_minutes) || execution.max_runtime_minutes <= 0) {
          errors.push(
            "`execution.max_runtime_minutes` must be a positive number.",
          )
        }
      }

      if ("branch_prefix" in execution) {
        if (!isString(execution.branch_prefix) || execution.branch_prefix.length === 0) {
          errors.push("`execution.branch_prefix` must be a non-empty string.")
        }
      }

      if ("auto_run_tests" in execution && !isBoolean(execution.auto_run_tests)) {
        errors.push("`execution.auto_run_tests` must be a boolean.")
      }

      if ("max_plan_revisions" in execution) {
        if (
          !isNumber(execution.max_plan_revisions) ||
          execution.max_plan_revisions <= 0
        ) {
          errors.push("`execution.max_plan_revisions` must be a positive number.")
        }
      }
    }
  }

  // ── execution_environment ──
  if ("execution_environment" in config) {
    if (!isObject(config.execution_environment)) {
      errors.push("`execution_environment` must be an object.")
    } else {
      const env = config.execution_environment as Record<string, unknown>

      if ("workspace_root" in env && !isString(env.workspace_root)) {
        errors.push("`execution_environment.workspace_root` must be a string.")
      }

      if ("cleanup_on_success" in env && !isBoolean(env.cleanup_on_success)) {
        errors.push(
          "`execution_environment.cleanup_on_success` must be a boolean.",
        )
      }

      if ("cleanup_on_failure" in env && !isBoolean(env.cleanup_on_failure)) {
        errors.push(
          "`execution_environment.cleanup_on_failure` must be a boolean.",
        )
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}
