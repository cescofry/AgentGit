import { Skill, SkillInput, SkillResult, ExecutionContext } from "./interface"
import { TaskSafetyCheckerSkill } from "../security/checker"
import { IssueClassifierSkill } from "./builtin/issue-classifier"
import { PlanGeneratorSkill } from "./builtin/plan-generator"
import { PlanExecutorSkill } from "./builtin/plan-executor"
import { WorkspaceSetupSkill } from "./builtin/workspace-setup"
import { TestRunnerSkill } from "./builtin/test-runner"
import { DocsCheckerSkill } from "./builtin/docs-checker"
import { LintRunnerSkill } from "./builtin/lint-runner"
import { PrCreatorSkill } from "./builtin/pr-creator"

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map()

  /**
   * Register a skill. Overwrites any existing skill with the same name.
   */
  register(skill: Skill): void {
    this.skills.set(skill.name, skill)
  }

  /**
   * Get a skill by name.
   * Returns undefined if no skill with that name is registered.
   */
  get(name: string): Skill | undefined {
    return this.skills.get(name)
  }

  /**
   * List all registered skill names.
   */
  list(): string[] {
    return Array.from(this.skills.keys())
  }

  /**
   * Load all built-in skills.
   */
  loadBuiltins(): void {
    this.register(new TaskSafetyCheckerSkill())
    this.register(new IssueClassifierSkill())
    this.register(new PlanGeneratorSkill())
    this.register(new PlanExecutorSkill())
    this.register(new WorkspaceSetupSkill())
    this.register(new TestRunnerSkill())
    this.register(new DocsCheckerSkill())
    this.register(new LintRunnerSkill())
    this.register(new PrCreatorSkill())
  }

  /**
   * Load user-defined skills from .agentGit/skills/ in the repository.
   *
   * In v0.1, only skills of type "command" are supported.
   * Skills are loaded from the repository either via the GitHub API (if octokit
   * is provided) or from a local path on disk.
   *
   * @param octokit  - Octokit instance for GitHub API access, or null for local-only
   * @param owner    - Repository owner
   * @param repo     - Repository name
   * @param ref      - Git ref (branch/tag/sha) to read from, defaults to the default branch
   * @param localPath - Local filesystem path to the repo root (used for local loading)
   */
  async loadUserSkills(
    _octokit: any | null,
    _owner: string,
    _repo: string,
    _ref?: string,
    _localPath?: string,
  ): Promise<void> {
    // User-defined skill loading will be implemented when the YAML skill
    // definition parser is built. For now this is a no-op.
    //
    // Future implementation will:
    // 1. List files in .agentGit/skills/ (via GitHub API or local fs)
    // 2. Parse each YAML file into a skill definition
    // 3. Create a CommandSkill wrapper for type: "command" skills
    // 4. Register each skill in this registry
  }
}

/**
 * Create a new SkillRegistry instance.
 */
export function createSkillRegistry(): SkillRegistry {
  return new SkillRegistry()
}
