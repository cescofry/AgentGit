import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { DocsCheckerSkill } from "../../src/skills/builtin/docs-checker"
import { ExecutionContext, SkillInput } from "../../src/skills/interface"
import { createLogger } from "../../src/utils/logger"
import { DEFAULT_CONFIG } from "../../src/config/defaults"

describe("DocsCheckerSkill", () => {
  let skill: DocsCheckerSkill
  let context: ExecutionContext
  let tmpDir: string

  beforeEach(() => {
    vi.clearAllMocks()

    skill = new DocsCheckerSkill()

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docs-check-"))

    context = {
      issueContext: {
        issueNumber: 42,
        issueTitle: "Fix bug",
        issueBody: "",
        comments: [],
        labels: [],
        repoUrl: "https://github.com/owner/repo",
        repoOwner: "owner",
        repoName: "repo",
      },
      repoConfig: { ...DEFAULT_CONFIG },
      logger: createLogger("error"),
      harness: {
        name: "mock",
        proposePlan: vi.fn(),
        revisePlan: vi.fn(),
        executePlan: vi.fn(),
      },
      workspacePath: tmpDir,
      signingSecret: "test-secret",
    }
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it("has correct name and description", () => {
    expect(skill.name).toBe("docs-checker")
    expect(skill.description).toContain("documentation")
  })

  it("produces warning when source changed without docs update", async () => {
    // Create README in workspace
    fs.writeFileSync(path.join(tmpDir, "README.md"), "# My Project")

    const input: SkillInput = {
      workspace: tmpDir,
      diff_summary: "src/handler.ts | 15 +++---\nsrc/utils.ts | 3 +",
    }

    const result = await skill.execute(input, context)

    expect(result.success).toBe(true) // non-blocking
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0]).toContain("documentation")
    expect(result.data.source_changed).toBe(true)
    expect(result.data.docs_changed).toBe(false)
  })

  it("no warning when docs are updated alongside source", async () => {
    fs.writeFileSync(path.join(tmpDir, "README.md"), "# My Project")

    const input: SkillInput = {
      workspace: tmpDir,
      diff_summary: "src/handler.ts | 15 +++---\nREADME.md | 3 +",
    }

    const result = await skill.execute(input, context)

    expect(result.success).toBe(true)
    expect(result.warnings).toHaveLength(0)
    expect(result.data.source_changed).toBe(true)
    expect(result.data.docs_changed).toBe(true)
  })

  it("no warning when only docs change", async () => {
    fs.writeFileSync(path.join(tmpDir, "README.md"), "# My Project")

    const input: SkillInput = {
      workspace: tmpDir,
      diff_summary: "docs/guide.md | 10 +++",
    }

    const result = await skill.execute(input, context)

    expect(result.success).toBe(true)
    expect(result.warnings).toHaveLength(0)
  })

  it("no warning when source changes but no README/docs exist", async () => {
    // No README or docs/ directory
    const input: SkillInput = {
      workspace: tmpDir,
      diff_summary: "src/handler.ts | 5 +++",
    }

    const result = await skill.execute(input, context)

    expect(result.success).toBe(true)
    expect(result.warnings).toHaveLength(0)
  })

  it("detects docs/ directory", async () => {
    fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true })
    fs.writeFileSync(path.join(tmpDir, "docs", "api.md"), "# API")

    const input: SkillInput = {
      workspace: tmpDir,
      diff_summary: "src/main.py | 20 +++---",
    }

    const result = await skill.execute(input, context)

    expect(result.success).toBe(true)
    expect(result.data.docs_dir_exists).toBe(true)
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it("returns error when workspace is missing", async () => {
    const result = await skill.execute({ diff_summary: "foo" }, context)

    expect(result.success).toBe(false)
    expect(result.error).toContain("Missing required input: workspace")
  })

  it("always returns success (non-blocking)", async () => {
    fs.writeFileSync(path.join(tmpDir, "README.md"), "# Proj")

    const input: SkillInput = {
      workspace: tmpDir,
      diff_summary: "src/big-change.go | 500 +++",
    }

    const result = await skill.execute(input, context)

    // Even with warnings, the result is success
    expect(result.success).toBe(true)
  })
})
