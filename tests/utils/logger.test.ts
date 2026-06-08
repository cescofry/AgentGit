import { describe, it, expect, vi, beforeEach } from "vitest"
import { createLogger } from "../../src/utils/logger"
import type { LogLevel } from "../../src/utils/logger"

describe("logger", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  describe("createLogger", () => {
    it("creates a logger with default info level", () => {
      const logger = createLogger()
      expect(logger).toBeDefined()
      expect(logger.debug).toBeTypeOf("function")
      expect(logger.info).toBeTypeOf("function")
      expect(logger.warn).toBeTypeOf("function")
      expect(logger.error).toBeTypeOf("function")
      expect(logger.child).toBeTypeOf("function")
    })

    it("creates a logger with a specified level", () => {
      const logger = createLogger("debug")
      expect(logger).toBeDefined()
    })
  })

  describe("log level filtering", () => {
    it("info logger suppresses debug messages", () => {
      const spy = vi.spyOn(console, "debug").mockImplementation(() => {})
      const logger = createLogger("info")
      logger.debug("should not appear")
      expect(spy).not.toHaveBeenCalled()
    })

    it("info logger emits info messages", () => {
      const spy = vi.spyOn(console, "info").mockImplementation(() => {})
      const logger = createLogger("info")
      logger.info("visible message")
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0][0]).toContain("INFO")
      expect(spy.mock.calls[0][0]).toContain("visible message")
    })

    it("info logger emits warn messages", () => {
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {})
      const logger = createLogger("info")
      logger.warn("warning message")
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0][0]).toContain("WARN")
    })

    it("info logger emits error messages", () => {
      const spy = vi.spyOn(console, "error").mockImplementation(() => {})
      const logger = createLogger("info")
      logger.error("error message")
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0][0]).toContain("ERROR")
    })

    it("debug logger emits debug messages", () => {
      const spy = vi.spyOn(console, "debug").mockImplementation(() => {})
      const logger = createLogger("debug")
      logger.debug("debug message")
      expect(spy).toHaveBeenCalledTimes(1)
      expect(spy.mock.calls[0][0]).toContain("DEBUG")
    })

    it("error logger suppresses info and warn", () => {
      const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

      const logger = createLogger("error")
      logger.info("suppressed")
      logger.warn("suppressed")
      logger.error("visible")

      expect(infoSpy).not.toHaveBeenCalled()
      expect(warnSpy).not.toHaveBeenCalled()
      expect(errorSpy).toHaveBeenCalledTimes(1)
    })
  })

  describe("structured data", () => {
    it("includes data fields in output", () => {
      const spy = vi.spyOn(console, "info").mockImplementation(() => {})
      const logger = createLogger("info")
      logger.info("test", { key: "value", count: 42 })
      expect(spy).toHaveBeenCalledTimes(1)
      const output = spy.mock.calls[0][0] as string
      expect(output).toContain('"key":"value"')
      expect(output).toContain('"count":42')
    })

    it("omits data block when no data provided", () => {
      const spy = vi.spyOn(console, "info").mockImplementation(() => {})
      const logger = createLogger("info")
      logger.info("clean message")
      const output = spy.mock.calls[0][0] as string
      // Should end with the message, no trailing JSON
      expect(output).toMatch(/clean message$/)
    })
  })

  describe("child logger", () => {
    it("creates a child that inherits parent context", () => {
      const spy = vi.spyOn(console, "info").mockImplementation(() => {})
      const parent = createLogger("info")
      const child = parent.child({ component: "webhook" })
      child.info("child message")
      const output = spy.mock.calls[0][0] as string
      expect(output).toContain('"component":"webhook"')
      expect(output).toContain("child message")
    })

    it("child merges additional data with context", () => {
      const spy = vi.spyOn(console, "info").mockImplementation(() => {})
      const child = createLogger("info").child({ component: "webhook" })
      child.info("with extra", { requestId: "abc" })
      const output = spy.mock.calls[0][0] as string
      expect(output).toContain('"component":"webhook"')
      expect(output).toContain('"requestId":"abc"')
    })

    it("child inherits the log level from parent", () => {
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {})

      const parent = createLogger("warn")
      const child = parent.child({ module: "test" })
      child.debug("suppressed")
      child.info("also suppressed")

      expect(debugSpy).not.toHaveBeenCalled()
      expect(infoSpy).not.toHaveBeenCalled()
    })

    it("supports nested child loggers", () => {
      const spy = vi.spyOn(console, "info").mockImplementation(() => {})
      const grandchild = createLogger("info")
        .child({ service: "agentgit" })
        .child({ component: "webhook" })
      grandchild.info("nested")
      const output = spy.mock.calls[0][0] as string
      expect(output).toContain('"service":"agentgit"')
      expect(output).toContain('"component":"webhook"')
    })
  })

  describe("timestamp format", () => {
    it("includes ISO timestamp in output", () => {
      const spy = vi.spyOn(console, "info").mockImplementation(() => {})
      const logger = createLogger("info")
      logger.info("timestamped")
      const output = spy.mock.calls[0][0] as string
      // ISO timestamp pattern: [2024-01-01T00:00:00.000Z]
      expect(output).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })
  })
})
