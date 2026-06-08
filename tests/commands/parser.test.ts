import { describe, it, expect } from "vitest"
import { parseCommand } from "../../src/commands/parser"

describe("parseCommand", () => {
  // ── Valid commands ──

  describe("valid commands return correct action and args", () => {
    it("parses /agent plan", () => {
      const result = parseCommand("/agent plan")
      expect(result).toEqual({ action: "plan", args: "" })
    })

    it("parses /agent approve", () => {
      const result = parseCommand("/agent approve")
      expect(result).toEqual({ action: "approve", args: "" })
    })

    it("parses /agent run", () => {
      const result = parseCommand("/agent run")
      expect(result).toEqual({ action: "run", args: "" })
    })

    it("parses /agent stop", () => {
      const result = parseCommand("/agent stop")
      expect(result).toEqual({ action: "stop", args: "" })
    })

    it("parses /agent retry", () => {
      const result = parseCommand("/agent retry")
      expect(result).toEqual({ action: "retry", args: "" })
    })

    it("parses /agent status", () => {
      const result = parseCommand("/agent status")
      expect(result).toEqual({ action: "status", args: "" })
    })

    it("parses /agent delegates", () => {
      const result = parseCommand("/agent delegates")
      expect(result).toEqual({ action: "delegates", args: "" })
    })

    it("parses /agent unlock-security", () => {
      const result = parseCommand("/agent unlock-security")
      expect(result).toEqual({ action: "unlock-security", args: "" })
    })

    it("parses /agent close-unsafe", () => {
      const result = parseCommand("/agent close-unsafe")
      expect(result).toEqual({ action: "close-unsafe", args: "" })
    })

    it("parses /agent security-status", () => {
      const result = parseCommand("/agent security-status")
      expect(result).toEqual({ action: "security-status", args: "" })
    })

    it("parses /agent undelegate", () => {
      const result = parseCommand("/agent undelegate")
      expect(result).toEqual({ action: "undelegate", args: "" })
    })
  })

  // ── Args handling ──

  describe("args parsing", () => {
    it("parses /agent revise with multi-word feedback", () => {
      const result = parseCommand("/agent revise fix the error handling")
      expect(result).toEqual({
        action: "revise",
        args: "fix the error handling",
      })
    })

    it("parses /agent delegate with user and command args", () => {
      const result = parseCommand("/agent delegate @alice plan")
      expect(result).toEqual({ action: "delegate", args: "@alice plan" })
    })

    it("parses /agent undelegate with args", () => {
      const result = parseCommand("/agent undelegate @alice")
      expect(result).toEqual({ action: "undelegate", args: "@alice" })
    })

    it("returns empty args for command with no arguments", () => {
      const result = parseCommand("/agent approve")
      expect(result).toEqual({ action: "approve", args: "" })
    })

    it("trims trailing whitespace from args", () => {
      const result = parseCommand("/agent revise some feedback   ")
      expect(result).toEqual({ action: "revise", args: "some feedback" })
    })
  })

  // ── Case insensitivity ──

  describe("case-insensitive matching", () => {
    it("parses /agent PLAN as plan", () => {
      const result = parseCommand("/agent PLAN")
      expect(result).toEqual({ action: "plan", args: "" })
    })

    it("parses /agent Approve as approve", () => {
      const result = parseCommand("/agent Approve")
      expect(result).toEqual({ action: "approve", args: "" })
    })

    it("parses /agent RUN some args", () => {
      const result = parseCommand("/agent RUN some args")
      expect(result).toEqual({ action: "run", args: "some args" })
    })

    it("parses /AGENT plan (uppercase prefix)", () => {
      const result = parseCommand("/AGENT plan")
      expect(result).toEqual({ action: "plan", args: "" })
    })

    it("parses mixed case /Agent Revise feedback", () => {
      const result = parseCommand("/Agent Revise feedback here")
      expect(result).toEqual({ action: "revise", args: "feedback here" })
    })
  })

  // ── Whitespace handling ──

  describe("extra whitespace handling", () => {
    it("handles multiple spaces between /agent and action", () => {
      const result = parseCommand("/agent    plan")
      expect(result).toEqual({ action: "plan", args: "" })
    })

    it("handles tabs between /agent and action", () => {
      const result = parseCommand("/agent\tplan")
      expect(result).toEqual({ action: "plan", args: "" })
    })

    it("handles multiple spaces between action and args", () => {
      const result = parseCommand("/agent revise    fix the bugs")
      expect(result).toEqual({ action: "revise", args: "fix the bugs" })
    })

    it("handles leading whitespace before /agent on the line", () => {
      const result = parseCommand("   /agent plan")
      expect(result).toEqual({ action: "plan", args: "" })
    })
  })

  // ── Command in middle of comment body ──

  describe("command in middle of comment body", () => {
    it("finds command after introductory text", () => {
      const body = "Looks good to me!\n/agent approve"
      const result = parseCommand(body)
      expect(result).toEqual({ action: "approve", args: "" })
    })

    it("finds command between other text", () => {
      const body = "Some context about the issue.\n/agent plan\nThanks!"
      const result = parseCommand(body)
      expect(result).toEqual({ action: "plan", args: "" })
    })

    it("finds command with surrounding prose on same line", () => {
      const body = "Hey please run /agent approve for this"
      const result = parseCommand(body)
      expect(result).toEqual({ action: "approve", args: "for this" })
    })
  })

  // ── Multi-line comments ──

  describe("multi-line comments", () => {
    it("finds command on second line", () => {
      const body = "I reviewed the changes.\n/agent approve\nLGTM!"
      const result = parseCommand(body)
      expect(result).toEqual({ action: "approve", args: "" })
    })

    it("finds command on third line", () => {
      const body = "line one\nline two\n/agent revise add tests"
      const result = parseCommand(body)
      expect(result).toEqual({ action: "revise", args: "add tests" })
    })

    it("uses the first valid command when multiple are present", () => {
      const body = "/agent plan\n/agent approve"
      const result = parseCommand(body)
      expect(result).toEqual({ action: "plan", args: "" })
    })

    it("skips invalid commands and finds valid one on later line", () => {
      const body = "/agent invalid\n/agent plan"
      const result = parseCommand(body)
      expect(result).toEqual({ action: "plan", args: "" })
    })
  })

  // ── Unknown commands return null ──

  describe("unknown commands return null", () => {
    it("returns null for /agent unknown", () => {
      expect(parseCommand("/agent unknown")).toBeNull()
    })

    it("returns null for /agent foobar", () => {
      expect(parseCommand("/agent foobar")).toBeNull()
    })

    it("returns null for /agent deploy", () => {
      expect(parseCommand("/agent deploy")).toBeNull()
    })
  })

  // ── Non-command text returns null ──

  describe("non-command text returns null", () => {
    it("returns null for plain text", () => {
      expect(parseCommand("This is a regular comment")).toBeNull()
    })

    it("returns null for empty string", () => {
      expect(parseCommand("")).toBeNull()
    })

    it("returns null for /agent with no action", () => {
      expect(parseCommand("/agent")).toBeNull()
    })

    it("returns null for /agent followed only by whitespace", () => {
      expect(parseCommand("/agent   ")).toBeNull()
    })

    it("returns null for text mentioning agent without slash", () => {
      expect(parseCommand("agent plan")).toBeNull()
    })

    it("returns null for /agentplan (no space)", () => {
      expect(parseCommand("/agentplan")).toBeNull()
    })

    it("returns null for null-ish input", () => {
      expect(parseCommand(null as any)).toBeNull()
      expect(parseCommand(undefined as any)).toBeNull()
    })
  })
})
