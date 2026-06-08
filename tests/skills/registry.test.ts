import { describe, it, expect } from "vitest"
import { SkillRegistry, createSkillRegistry } from "../../src/skills/registry"
import { Skill, SkillInput, SkillResult, ExecutionContext } from "../../src/skills/interface"

// ── Helpers ──

function makeSkill(name: string, description = "test skill"): Skill {
  return {
    name,
    description,
    async execute(_input: SkillInput, _context: ExecutionContext): Promise<SkillResult> {
      return { success: true, data: { name }, warnings: [] }
    },
  }
}

// ── Tests ──

describe("SkillRegistry", () => {
  describe("register and get", () => {
    it("registers a skill and retrieves it by name", () => {
      const registry = new SkillRegistry()
      const skill = makeSkill("test-skill")

      registry.register(skill)

      expect(registry.get("test-skill")).toBe(skill)
    })

    it("returns undefined for an unknown skill", () => {
      const registry = new SkillRegistry()

      expect(registry.get("nonexistent")).toBeUndefined()
    })

    it("overwrites a skill with the same name", () => {
      const registry = new SkillRegistry()
      const skill1 = makeSkill("dupe", "first")
      const skill2 = makeSkill("dupe", "second")

      registry.register(skill1)
      registry.register(skill2)

      const retrieved = registry.get("dupe")
      expect(retrieved).toBe(skill2)
      expect(retrieved?.description).toBe("second")
    })
  })

  describe("list", () => {
    it("returns all registered skill names", () => {
      const registry = new SkillRegistry()
      registry.register(makeSkill("alpha"))
      registry.register(makeSkill("beta"))
      registry.register(makeSkill("gamma"))

      const names = registry.list()

      expect(names).toHaveLength(3)
      expect(names).toContain("alpha")
      expect(names).toContain("beta")
      expect(names).toContain("gamma")
    })

    it("returns an empty array when no skills are registered", () => {
      const registry = new SkillRegistry()

      expect(registry.list()).toEqual([])
    })

    it("reflects removals via re-registration", () => {
      const registry = new SkillRegistry()
      registry.register(makeSkill("a"))
      registry.register(makeSkill("b"))

      expect(registry.list()).toHaveLength(2)
    })
  })

  describe("loadBuiltins", () => {
    it("does not throw (placeholder for future built-in skills)", () => {
      const registry = new SkillRegistry()

      expect(() => registry.loadBuiltins()).not.toThrow()
    })
  })

  describe("loadUserSkills", () => {
    it("does not throw (placeholder for future user skill loading)", async () => {
      const registry = new SkillRegistry()

      await expect(
        registry.loadUserSkills(null, "owner", "repo"),
      ).resolves.toBeUndefined()
    })
  })

  describe("createSkillRegistry", () => {
    it("returns a fresh SkillRegistry instance", () => {
      const registry = createSkillRegistry()

      expect(registry).toBeInstanceOf(SkillRegistry)
      expect(registry.list()).toEqual([])
    })
  })
})
