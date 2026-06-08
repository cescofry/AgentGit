export interface IssueContext {
  issueNumber: number
  issueTitle: string
  issueBody: string
  comments: Array<{ author: string; body: string; createdAt: string }>
  labels: string[]
  repoUrl: string
  repoOwner: string
  repoName: string
}

export interface RepoConfig {
  taskType: string // "bug" | "feature" | "docs" | "ui" | custom
  instructions: string
  testCommand?: string
  maxRuntimeMinutes: number
  branchPrefix: string
}

export interface PlanResult {
  plan: string
  planVersion: number
  confidence: number // 0-1
  warnings: string[]
}

export interface ExecutionResult {
  success: boolean
  branch: string
  prUrl?: string
  diffSummary: string
  testResults?: string
  errors: string[]
}

export interface CodingHarness {
  name: string
  proposePlan(
    issueContext: IssueContext,
    repoConfig: RepoConfig,
  ): Promise<PlanResult>
  revisePlan(
    issueContext: IssueContext,
    priorPlan: string,
    adminFeedback: string,
    repoConfig: RepoConfig,
  ): Promise<PlanResult>
  executePlan(
    issueContext: IssueContext,
    approvedPlan: string,
    workspace: string,
    repoConfig: RepoConfig,
  ): Promise<ExecutionResult>
}
