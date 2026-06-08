import {
  CodingHarness,
  IssueContext,
  RepoConfig,
  PlanResult,
  ExecutionResult,
} from "./interface"

export class PiHarness implements CodingHarness {
  name = "pi"

  async proposePlan(
    _issueContext: IssueContext,
    _repoConfig: RepoConfig,
  ): Promise<PlanResult> {
    throw new Error("Pi harness not yet implemented")
  }

  async revisePlan(
    _issueContext: IssueContext,
    _priorPlan: string,
    _adminFeedback: string,
    _repoConfig: RepoConfig,
  ): Promise<PlanResult> {
    throw new Error("Pi harness not yet implemented")
  }

  async executePlan(
    _issueContext: IssueContext,
    _approvedPlan: string,
    _workspace: string,
    _repoConfig: RepoConfig,
  ): Promise<ExecutionResult> {
    throw new Error("Pi harness not yet implemented")
  }
}
