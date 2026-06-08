import { describe, it, expect } from "vitest"
import {
  AgentState,
  Trigger,
  TRANSITION_TABLE,
  getNextState,
  getValidTriggers,
} from "../../src/state/transitions"

describe("transitions", () => {
  describe("TRANSITION_TABLE completeness", () => {
    it("has entries for all states including null", () => {
      const expectedStates = [
        "null",
        "agent:ready",
        "agent:security-review",
        "agent:locked-security",
        "agent:planning",
        "agent:plan-review",
        "agent:approved",
        "agent:working",
        "agent:pr-opened",
        "agent:blocked",
        "agent:done",
        "agent:cancelled",
      ]
      for (const state of expectedStates) {
        expect(TRANSITION_TABLE[state]).toBeDefined()
      }
    })
  })

  describe("getNextState - valid transitions", () => {
    const validCases: Array<{ from: AgentState; trigger: Trigger; to: AgentState }> = [
      // null -> agent:security-review
      { from: null, trigger: "plan_requested", to: "agent:security-review" },
      // agent:ready -> agent:security-review
      { from: "agent:ready", trigger: "plan_requested", to: "agent:security-review" },
      // agent:security-review -> agent:planning
      { from: "agent:security-review", trigger: "security_review_passed", to: "agent:planning" },
      // agent:security-review -> agent:locked-security
      { from: "agent:security-review", trigger: "security_review_failed", to: "agent:locked-security" },
      // agent:locked-security -> agent:planning
      { from: "agent:locked-security", trigger: "unlock_security", to: "agent:planning" },
      // agent:locked-security -> null (close_unsafe)
      { from: "agent:locked-security", trigger: "close_unsafe", to: null },
      // agent:planning -> agent:plan-review
      { from: "agent:planning", trigger: "plan_completed", to: "agent:plan-review" },
      // agent:planning -> agent:blocked
      { from: "agent:planning", trigger: "plan_failed", to: "agent:blocked" },
      // agent:plan-review -> agent:planning
      { from: "agent:plan-review", trigger: "revise_requested", to: "agent:planning" },
      // agent:plan-review -> agent:approved
      { from: "agent:plan-review", trigger: "plan_approved", to: "agent:approved" },
      // agent:approved -> agent:working
      { from: "agent:approved", trigger: "work_started", to: "agent:working" },
      // agent:working -> agent:pr-opened
      { from: "agent:working", trigger: "build_completed", to: "agent:pr-opened" },
      // agent:working -> agent:blocked
      { from: "agent:working", trigger: "build_failed", to: "agent:blocked" },
      // agent:blocked -> agent:planning (retry)
      { from: "agent:blocked", trigger: "retry_requested", to: "agent:planning" },
      // agent:pr-opened -> agent:done
      { from: "agent:pr-opened", trigger: "pr_merged", to: "agent:done" },
      // agent:cancelled -> agent:security-review (restart)
      { from: "agent:cancelled", trigger: "plan_requested", to: "agent:security-review" },
    ]

    for (const { from, trigger, to } of validCases) {
      it(`${from ?? "null"} + ${trigger} -> ${to ?? "null"}`, () => {
        const result = getNextState(from, trigger)
        expect(result.valid).toBe(true)
        expect(result.from).toBe(from)
        expect(result.to).toBe(to)
        expect(result.trigger).toBe(trigger)
        expect(result.reason).toBeUndefined()
      })
    }
  })

  describe("getNextState - invalid transitions", () => {
    const invalidCases: Array<{ from: AgentState; trigger: Trigger }> = [
      { from: "agent:done", trigger: "plan_completed" as Trigger },
      { from: "agent:done", trigger: "work_started" as Trigger },
      { from: "agent:planning", trigger: "plan_approved" as Trigger },
      { from: "agent:pr-opened", trigger: "build_completed" as Trigger },
      { from: null, trigger: "pr_merged" as Trigger },
      { from: "agent:ready", trigger: "build_completed" as Trigger },
      { from: "agent:approved", trigger: "plan_completed" as Trigger },
    ]

    for (const { from, trigger } of invalidCases) {
      it(`${from ?? "null"} + ${trigger} -> INVALID`, () => {
        const result = getNextState(from, trigger)
        expect(result.valid).toBe(false)
        expect(result.from).toBe(from)
        expect(result.to).toBe(from) // stays in current state
        expect(result.trigger).toBe(trigger)
        expect(result.reason).toBeDefined()
        expect(result.reason!.length).toBeGreaterThan(0)
      })
    }
  })

  describe("getNextState - stop_requested from active states", () => {
    const activeStates: AgentState[] = [
      null,
      "agent:ready",
      "agent:security-review",
      "agent:locked-security",
      "agent:planning",
      "agent:plan-review",
      "agent:approved",
      "agent:working",
      "agent:pr-opened",
      "agent:blocked",
    ]

    for (const state of activeStates) {
      it(`stop_requested from ${state ?? "null"} -> agent:cancelled`, () => {
        const result = getNextState(state, "stop_requested")
        expect(result.valid).toBe(true)
        expect(result.to).toBe("agent:cancelled")
      })
    }
  })

  describe("getNextState - plan_requested from null and agent:ready", () => {
    it("plan_requested from null -> agent:security-review", () => {
      const result = getNextState(null, "plan_requested")
      expect(result.valid).toBe(true)
      expect(result.to).toBe("agent:security-review")
    })

    it("plan_requested from agent:ready -> agent:security-review", () => {
      const result = getNextState("agent:ready", "plan_requested")
      expect(result.valid).toBe(true)
      expect(result.to).toBe("agent:security-review")
    })
  })

  describe("getNextState - retry_requested from agent:blocked", () => {
    it("retry_requested from agent:blocked -> agent:planning", () => {
      const result = getNextState("agent:blocked", "retry_requested")
      expect(result.valid).toBe(true)
      expect(result.to).toBe("agent:planning")
    })
  })

  describe("getValidTriggers", () => {
    it("returns correct triggers for null state", () => {
      const triggers = getValidTriggers(null)
      expect(triggers).toContain("plan_requested")
      expect(triggers).toContain("stop_requested")
      expect(triggers).toContain("issue_closed")
    })

    it("returns correct triggers for agent:security-review", () => {
      const triggers = getValidTriggers("agent:security-review")
      expect(triggers).toContain("security_review_passed")
      expect(triggers).toContain("security_review_failed")
      expect(triggers).toContain("stop_requested")
      expect(triggers).toContain("issue_closed")
      expect(triggers).not.toContain("plan_requested")
    })

    it("returns correct triggers for agent:plan-review", () => {
      const triggers = getValidTriggers("agent:plan-review")
      expect(triggers).toContain("revise_requested")
      expect(triggers).toContain("plan_approved")
      expect(triggers).toContain("stop_requested")
    })

    it("returns correct triggers for agent:blocked", () => {
      const triggers = getValidTriggers("agent:blocked")
      expect(triggers).toContain("retry_requested")
      expect(triggers).toContain("stop_requested")
    })

    it("returns correct triggers for agent:done", () => {
      const triggers = getValidTriggers("agent:done")
      expect(triggers).toContain("issue_closed")
      expect(triggers).not.toContain("stop_requested")
    })

    it("returns correct triggers for agent:cancelled", () => {
      const triggers = getValidTriggers("agent:cancelled")
      expect(triggers).toContain("plan_requested")
    })

    it("returns empty array for unknown state", () => {
      // Cast to bypass type checking - simulating corrupted data
      const triggers = getValidTriggers("agent:nonexistent" as AgentState)
      expect(triggers).toEqual([])
    })
  })
})
