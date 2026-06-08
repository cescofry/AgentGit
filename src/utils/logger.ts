export type LogLevel = "debug" | "info" | "warn" | "error"

export interface Logger {
  debug(msg: string, data?: Record<string, any>): void
  info(msg: string, data?: Record<string, any>): void
  warn(msg: string, data?: Record<string, any>): void
  error(msg: string, data?: Record<string, any>): void
  child(context: Record<string, any>): Logger
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

function shouldLog(configured: LogLevel, target: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[target] >= LOG_LEVEL_PRIORITY[configured]
}

function formatEntry(
  level: LogLevel,
  msg: string,
  context: Record<string, any>,
  data?: Record<string, any>,
): string {
  const timestamp = new Date().toISOString()
  const merged = { ...context, ...data }
  const fields = Object.keys(merged).length > 0 ? ` ${JSON.stringify(merged)}` : ""
  return `[${timestamp}] ${level.toUpperCase()} ${msg}${fields}`
}

export function createLogger(
  level: LogLevel = "info",
  context: Record<string, any> = {},
): Logger {
  return {
    debug(msg: string, data?: Record<string, any>): void {
      if (shouldLog(level, "debug")) {
        console.debug(formatEntry("debug", msg, context, data))
      }
    },

    info(msg: string, data?: Record<string, any>): void {
      if (shouldLog(level, "info")) {
        console.info(formatEntry("info", msg, context, data))
      }
    },

    warn(msg: string, data?: Record<string, any>): void {
      if (shouldLog(level, "warn")) {
        console.warn(formatEntry("warn", msg, context, data))
      }
    },

    error(msg: string, data?: Record<string, any>): void {
      if (shouldLog(level, "error")) {
        console.error(formatEntry("error", msg, context, data))
      }
    },

    child(childContext: Record<string, any>): Logger {
      return createLogger(level, { ...context, ...childContext })
    },
  }
}
