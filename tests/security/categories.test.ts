import { describe, it, expect } from "vitest"
import {
  ALL_DISALLOWED_CATEGORIES,
  CATEGORY_DEFINITIONS,
  DisallowedCategory,
} from "../../src/security/categories"

describe("categories", () => {
  describe("ALL_DISALLOWED_CATEGORIES", () => {
    it("contains all six disallowed categories", () => {
      const expected: DisallowedCategory[] = [
        "credential_theft",
        "malware",
        "data_exfiltration",
        "abuse",
        "policy_bypass",
        "destructive_change",
      ]
      expect(ALL_DISALLOWED_CATEGORIES).toEqual(expected)
    })

    it("has no duplicates", () => {
      const unique = new Set(ALL_DISALLOWED_CATEGORIES)
      expect(unique.size).toBe(ALL_DISALLOWED_CATEGORIES.length)
    })
  })

  describe("CATEGORY_DEFINITIONS", () => {
    it("has a definition for every category", () => {
      const definedNames = CATEGORY_DEFINITIONS.map((d) => d.name)
      for (const cat of ALL_DISALLOWED_CATEGORIES) {
        expect(definedNames).toContain(cat)
      }
    })

    it("each definition has a non-empty description", () => {
      for (const def of CATEGORY_DEFINITIONS) {
        expect(def.description.length).toBeGreaterThan(0)
      }
    })

    it("each definition has at least one example", () => {
      for (const def of CATEGORY_DEFINITIONS) {
        expect(def.examples.length).toBeGreaterThanOrEqual(1)
      }
    })

    it("each definition has at least three examples", () => {
      for (const def of CATEGORY_DEFINITIONS) {
        expect(def.examples.length).toBeGreaterThanOrEqual(3)
      }
    })

    it("examples are non-empty strings", () => {
      for (const def of CATEGORY_DEFINITIONS) {
        for (const example of def.examples) {
          expect(typeof example).toBe("string")
          expect(example.length).toBeGreaterThan(0)
        }
      }
    })

    it("definition names match the DisallowedCategory type", () => {
      for (const def of CATEGORY_DEFINITIONS) {
        expect(ALL_DISALLOWED_CATEGORIES).toContain(def.name)
      }
    })
  })
})
