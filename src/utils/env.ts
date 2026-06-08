import * as fs from "fs"
import type { LogLevel } from "./logger"

export interface EnvConfig {
  GITHUB_APP_ID: string
  GITHUB_APP_PRIVATE_KEY: string
  GITHUB_WEBHOOK_SECRET: string
  AGENTGIT_SIGNING_SECRET: string
  AGENTGIT_PORT: number
  AGENTGIT_LOG_LEVEL: LogLevel
}

const VALID_LOG_LEVELS: LogLevel[] = ["debug", "info", "warn", "error"]

const REQUIRED_VARS = [
  "GITHUB_APP_ID",
  "GITHUB_WEBHOOK_SECRET",
  "AGENTGIT_SIGNING_SECRET",
] as const

function resolvePrivateKey(): string {
  const inline = process.env.GITHUB_APP_PRIVATE_KEY
  if (inline) {
    return inline
  }

  const keyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH
  if (keyPath) {
    if (!fs.existsSync(keyPath)) {
      throw new Error(
        `GITHUB_APP_PRIVATE_KEY_PATH points to non-existent file: ${keyPath}`,
      )
    }
    return fs.readFileSync(keyPath, "utf-8")
  }

  throw new Error(
    "Either GITHUB_APP_PRIVATE_KEY or GITHUB_APP_PRIVATE_KEY_PATH must be set",
  )
}

function resolvePort(): number {
  const raw = process.env.AGENTGIT_PORT
  if (!raw) return 3000

  const parsed = parseInt(raw, 10)
  if (isNaN(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`AGENTGIT_PORT must be a valid port number (1-65535), got: ${raw}`)
  }
  return parsed
}

function resolveLogLevel(): LogLevel {
  const raw = process.env.AGENTGIT_LOG_LEVEL
  if (!raw) return "info"

  if (!VALID_LOG_LEVELS.includes(raw as LogLevel)) {
    throw new Error(
      `AGENTGIT_LOG_LEVEL must be one of ${VALID_LOG_LEVELS.join(", ")}, got: ${raw}`,
    )
  }
  return raw as LogLevel
}

/**
 * Load and validate all environment variables.
 * Throws on missing required variables or invalid values.
 */
export function loadEnv(): EnvConfig {
  const { valid, missing } = validateEnv()
  if (!valid) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`,
    )
  }

  return {
    GITHUB_APP_ID: process.env.GITHUB_APP_ID!,
    GITHUB_APP_PRIVATE_KEY: resolvePrivateKey(),
    GITHUB_WEBHOOK_SECRET: process.env.GITHUB_WEBHOOK_SECRET!,
    AGENTGIT_SIGNING_SECRET: process.env.AGENTGIT_SIGNING_SECRET!,
    AGENTGIT_PORT: resolvePort(),
    AGENTGIT_LOG_LEVEL: resolveLogLevel(),
  }
}

/**
 * Validate environment variables without loading.
 * If partial is true, only warns on missing optional vars.
 */
export function validateEnv(partial?: boolean): {
  valid: boolean
  missing: string[]
  warnings: string[]
} {
  const missing: string[] = []
  const warnings: string[] = []

  for (const name of REQUIRED_VARS) {
    if (!process.env[name]) {
      missing.push(name)
    }
  }

  // Private key: either inline or path must be set
  if (!process.env.GITHUB_APP_PRIVATE_KEY && !process.env.GITHUB_APP_PRIVATE_KEY_PATH) {
    missing.push("GITHUB_APP_PRIVATE_KEY (or GITHUB_APP_PRIVATE_KEY_PATH)")
  }

  // Optional vars with warnings
  if (!process.env.AGENTGIT_PORT) {
    warnings.push("AGENTGIT_PORT not set, defaulting to 3000")
  }

  if (!process.env.AGENTGIT_LOG_LEVEL) {
    warnings.push('AGENTGIT_LOG_LEVEL not set, defaulting to "info"')
  } else if (!VALID_LOG_LEVELS.includes(process.env.AGENTGIT_LOG_LEVEL as LogLevel)) {
    warnings.push(
      `AGENTGIT_LOG_LEVEL "${process.env.AGENTGIT_LOG_LEVEL}" is invalid, will default to "info"`,
    )
  }

  const valid = partial ? true : missing.length === 0
  return { valid, missing, warnings }
}
