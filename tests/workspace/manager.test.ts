import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { createWorkspaceManager, WorkspaceManager } from "../../src/workspace/manager"

describe("WorkspaceManager", () => {
  let manager: WorkspaceManager
  let tmpRoot: string

  beforeEach(() => {
    manager = createWorkspaceManager()
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "agentgit-test-"))
  })

  afterEach(() => {
    // Clean up temp dirs
    if (fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true })
    }
  })

  describe("create", () => {
    it("creates workspace directory and returns correct info", async () => {
      const info = await manager.create(tmpRoot, "my-repo", 42, "agent/")

      expect(info.issueNumber).toBe(42)
      expect(info.repoName).toBe("my-repo")
      expect(info.branch).toBe("agent/issue-42")
      expect(info.path).toBe(path.join(tmpRoot, "my-repo", "issue-42"))
      expect(info.createdAt).toBeInstanceOf(Date)

      // Directory should actually exist
      expect(fs.existsSync(info.path)).toBe(true)
    })

    it("uses correct branch naming with prefix without trailing slash", async () => {
      const info = await manager.create(tmpRoot, "repo", 7, "bot")

      expect(info.branch).toBe("bot/issue-7")
    })

    it("uses correct branch naming with prefix with trailing slash", async () => {
      const info = await manager.create(tmpRoot, "repo", 100, "agent/")

      expect(info.branch).toBe("agent/issue-100")
    })

    it("creates nested directories recursively", async () => {
      const deepRoot = path.join(tmpRoot, "a", "b", "c")
      const info = await manager.create(deepRoot, "repo", 1, "agent/")

      expect(fs.existsSync(info.path)).toBe(true)
    })
  })

  describe("cleanup", () => {
    it("removes the workspace directory", async () => {
      const info = await manager.create(tmpRoot, "repo", 1, "agent/")
      expect(fs.existsSync(info.path)).toBe(true)

      await manager.cleanup(info.path)

      expect(fs.existsSync(info.path)).toBe(false)
    })

    it("does not throw if directory does not exist", async () => {
      const fakePath = path.join(tmpRoot, "nonexistent")

      await expect(manager.cleanup(fakePath)).resolves.toBeUndefined()
    })
  })

  describe("list", () => {
    it("returns empty array for non-existent rootDir", async () => {
      const result = await manager.list(path.join(tmpRoot, "nope"))

      expect(result).toEqual([])
    })

    it("returns empty array for rootDir with no workspaces", async () => {
      const result = await manager.list(tmpRoot)

      expect(result).toEqual([])
    })

    it("lists existing workspaces", async () => {
      await manager.create(tmpRoot, "repo-a", 1, "agent/")
      await manager.create(tmpRoot, "repo-a", 2, "agent/")
      await manager.create(tmpRoot, "repo-b", 10, "agent/")

      const result = await manager.list(tmpRoot)

      expect(result).toHaveLength(3)

      const issueNumbers = result.map((w) => w.issueNumber).sort((a, b) => a - b)
      expect(issueNumbers).toEqual([1, 2, 10])

      const repoNames = result.map((w) => w.repoName).sort()
      expect(repoNames).toEqual(["repo-a", "repo-a", "repo-b"])
    })

    it("ignores non-matching directory names", async () => {
      // Create a workspace directory
      await manager.create(tmpRoot, "repo", 5, "agent/")

      // Create a non-matching directory
      fs.mkdirSync(path.join(tmpRoot, "repo", "random-dir"), { recursive: true })

      const result = await manager.list(tmpRoot)

      expect(result).toHaveLength(1)
      expect(result[0].issueNumber).toBe(5)
    })
  })
})
