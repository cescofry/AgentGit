import { describe, it, expect } from "vitest"
import {
  STATE_LABELS,
  CLASSIFICATION_LABELS,
  ALL_LABELS,
  getCurrentState,
  isStateLabel,
  LabelDefinition,
} from "../../src/state/labels"

describe("labels", () => {
  describe("getCurrentState", () => {
    it("returns the correct state label from a mixed set of labels", () => {
      const labels = ["bug", "agent:working", "agent:type:feature", "help wanted"]
      expect(getCurrentState(labels)).toBe("agent:working")
    })

    it("returns the first state label when multiple are present", () => {
      const labels = ["agent:planning", "agent:blocked"]
      expect(getCurrentState(labels)).toBe("agent:planning")
    })

    it("returns null when no state label is present", () => {
      const labels = ["bug", "agent:type:feature", "help wanted"]
      expect(getCurrentState(labels)).toBeNull()
    })

    it("returns null for an empty label list", () => {
      expect(getCurrentState([])).toBeNull()
    })

    it("recognizes every state label", () => {
      for (const label of STATE_LABELS) {
        expect(getCurrentState([label.name])).toBe(label.name)
      }
    })

    it("does not match classification labels as state", () => {
      for (const label of CLASSIFICATION_LABELS) {
        expect(getCurrentState([label.name])).toBeNull()
      }
    })
  })

  describe("isStateLabel", () => {
    it("returns true for state labels", () => {
      for (const label of STATE_LABELS) {
        expect(isStateLabel(label.name)).toBe(true)
      }
    })

    it("returns false for classification labels", () => {
      for (const label of CLASSIFICATION_LABELS) {
        expect(isStateLabel(label.name)).toBe(false)
      }
    })

    it("returns false for arbitrary strings", () => {
      expect(isStateLabel("bug")).toBe(false)
      expect(isStateLabel("")).toBe(false)
      expect(isStateLabel("agent:nonexistent")).toBe(false)
    })
  })

  describe("label definitions", () => {
    it("all labels have unique names", () => {
      const names = ALL_LABELS.map((l) => l.name)
      const unique = new Set(names)
      expect(unique.size).toBe(names.length)
    })

    it("all state labels have category 'state'", () => {
      for (const label of STATE_LABELS) {
        expect(label.category).toBe("state")
      }
    })

    it("all classification labels have category 'classification'", () => {
      for (const label of CLASSIFICATION_LABELS) {
        expect(label.category).toBe("classification")
      }
    })

    it("ALL_LABELS contains all state and classification labels", () => {
      expect(ALL_LABELS.length).toBe(STATE_LABELS.length + CLASSIFICATION_LABELS.length)
      for (const label of STATE_LABELS) {
        expect(ALL_LABELS).toContainEqual(label)
      }
      for (const label of CLASSIFICATION_LABELS) {
        expect(ALL_LABELS).toContainEqual(label)
      }
    })

    it("all labels have non-empty name, color, and description", () => {
      for (const label of ALL_LABELS) {
        expect(label.name.length).toBeGreaterThan(0)
        expect(label.color.length).toBe(6) // 6-char hex
        expect(label.description.length).toBeGreaterThan(0)
      }
    })

    it("all colors are valid 6-character hex strings", () => {
      const hexRegex = /^[0-9A-Fa-f]{6}$/
      for (const label of ALL_LABELS) {
        expect(label.color).toMatch(hexRegex)
      }
    })
  })
})
