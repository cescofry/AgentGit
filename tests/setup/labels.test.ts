import { describe, it, expect, vi } from "vitest"
import { provisionLabels } from "../../src/setup/labels"
import { ALL_LABELS } from "../../src/state/labels"

function createMockOctokit(options: {
  existingLabels?: string[]
  failCreate?: string[]
  failGet?: string[]
}) {
  const existing = new Set(options.existingLabels ?? [])
  const failCreate = new Set(options.failCreate ?? [])
  const failGet = new Set(options.failGet ?? [])

  return {
    rest: {
      issues: {
        getLabel: vi.fn(async ({ name }: { name: string }) => {
          if (failGet.has(name)) {
            throw Object.assign(new Error(`Server error for ${name}`), { status: 500 })
          }
          if (existing.has(name)) {
            return { data: { name } }
          }
          throw Object.assign(new Error("Not found"), { status: 404 })
        }),
        createLabel: vi.fn(async ({ name }: { name: string }) => {
          if (failCreate.has(name)) {
            throw new Error(`Failed to create ${name}`)
          }
          return { data: { name } }
        }),
      },
    },
  }
}

describe("setup/labels", () => {
  describe("provisionLabels", () => {
    it("creates missing labels", async () => {
      const octokit = createMockOctokit({ existingLabels: [] })

      const result = await provisionLabels(octokit, "test-owner", "test-repo")

      expect(result.created).toHaveLength(ALL_LABELS.length)
      expect(result.existing).toHaveLength(0)
      expect(result.errors).toHaveLength(0)

      for (const label of ALL_LABELS) {
        expect(result.created).toContain(label.name)
      }
    })

    it("skips existing labels", async () => {
      const existingNames = ALL_LABELS.map((l) => l.name)
      const octokit = createMockOctokit({ existingLabels: existingNames })

      const result = await provisionLabels(octokit, "test-owner", "test-repo")

      expect(result.created).toHaveLength(0)
      expect(result.existing).toHaveLength(ALL_LABELS.length)
      expect(result.errors).toHaveLength(0)

      for (const label of ALL_LABELS) {
        expect(result.existing).toContain(label.name)
      }
    })

    it("handles a mix of existing and missing labels", async () => {
      const existing = ALL_LABELS.slice(0, 3).map((l) => l.name)
      const octokit = createMockOctokit({ existingLabels: existing })

      const result = await provisionLabels(octokit, "test-owner", "test-repo")

      expect(result.existing).toHaveLength(3)
      expect(result.created).toHaveLength(ALL_LABELS.length - 3)
      expect(result.errors).toHaveLength(0)
    })

    it("reports errors on failed creation", async () => {
      const failLabel = ALL_LABELS[0].name
      const octokit = createMockOctokit({ failCreate: [failLabel] })

      const result = await provisionLabels(octokit, "test-owner", "test-repo")

      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toContain(failLabel)
      expect(result.created).toHaveLength(ALL_LABELS.length - 1)
    })

    it("reports errors when getLabel fails with non-404", async () => {
      const failLabel = ALL_LABELS[0].name
      const octokit = createMockOctokit({ failGet: [failLabel] })

      const result = await provisionLabels(octokit, "test-owner", "test-repo")

      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toContain(failLabel)
    })

    it("accepts a custom label subset", async () => {
      const customLabels = ALL_LABELS.slice(0, 2)
      const octokit = createMockOctokit({ existingLabels: [] })

      const result = await provisionLabels(
        octokit,
        "test-owner",
        "test-repo",
        customLabels,
      )

      expect(result.created).toHaveLength(2)
      expect(result.existing).toHaveLength(0)
    })

    it("passes correct owner and repo to API calls", async () => {
      const octokit = createMockOctokit({ existingLabels: [] })
      const customLabels = ALL_LABELS.slice(0, 1)

      await provisionLabels(octokit, "my-org", "my-repo", customLabels)

      expect(octokit.rest.issues.getLabel).toHaveBeenCalledWith({
        owner: "my-org",
        repo: "my-repo",
        name: customLabels[0].name,
      })

      expect(octokit.rest.issues.createLabel).toHaveBeenCalledWith({
        owner: "my-org",
        repo: "my-repo",
        name: customLabels[0].name,
        color: customLabels[0].color,
        description: customLabels[0].description,
      })
    })
  })
})
