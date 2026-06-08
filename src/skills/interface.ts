import { IssueContext, CodingHarness } from "../harness/interface"
import { AgentGitConfig } from "../config/defaults"
import { Logger } from "../utils/logger"

export interface SkillInput {
  [key: string]: any
}

export interface SkillResult {
  success: boolean
  data: Record<string, any>
  warnings: string[]
  error?: string
}

export interface ExecutionContext {
  issueContext: IssueContext
  repoConfig: AgentGitConfig
  logger: Logger
  harness: CodingHarness
  workspacePath: string
  signingSecret: string
}

export interface Skill {
  name: string
  description: string
  execute(input: SkillInput, context: ExecutionContext): Promise<SkillResult>
}
