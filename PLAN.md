# GitAgent - Research & Planning Document

> **Status**: Phase 1 complete (Research). Phase 2 ready (Planning).
> **Last updated**: 2026-06-06

---

## Table of Contents

1. [Idea Summary](#idea-summary)
2. [Existing Open-Source Products](#existing-open-source-products)
3. [Architecture Decision](#architecture-decision)
4. [Harness Selection: OpenCode vs Pi](#harness-selection-opencode-vs-pi)
5. [Orchestrator: Probot](#orchestrator-probot)
6. [GitHub Integration](#github-integration)
7. [State Machine (Label-Based)](#state-machine-label-based)
8. [Configuration Model](#configuration-model)
9. [Feasibility & Risks](#feasibility--risks)
10. [MVP Scope](#mvp-scope)

---

## Idea Summary

Build a system that:

1. **Watches** a GitHub project for new issues.
2. **Picks** issues confirmed by an admin as ready for work.
3. **Proposes a plan** as a comment on the issue.
4. **Iterates** on the plan with the admin until approved.
5. **Executes** the plan and opens a PR linked to the issue.

Requirements:

- Deployed on a remote Linux server, available 24/7.
- Posts to GitHub as a bot (distinct from the human user).
- Uses OpenCode as the agentic harness (Pi as a viable alternative).
- Reacts to issue updates via webhooks or polls at intervals.
- Configurable per-task instructions (bug fix vs. feature vs. UI replication).

---

## Existing Open-Source Products

### Closely Related

| Product | Stars | License | Relevance | Key Difference |
|---|---|---|---|---|
| [OpenHands](https://github.com/OpenHands/OpenHands) | 76k | MIT | High | GitHub Action resolver: label `fix-me` or `@openhands-agent` triggers issue fix and PR. No admin-gated plan negotiation loop. |
| [SWE-agent / mini-SWE-agent](https://github.com/SWE-agent/SWE-agent) | 19k / 5k | MIT | Medium | Strong GitHub issue-solving harness. Not a GitHub bot workflow product by itself. |
| [Sweep](https://github.com/sweepai/sweep) | 7.7k | - | Low | Historically close to "issue to PR" but pivoted to JetBrains plugin. Abandoned as a bot. |

### Coding Agent Harnesses (Backbone Candidates)

| Product | Stars | License | Headless/SDK | GitHub Integration | Notes |
|---|---|---|---|---|---|
| [OpenCode](https://github.com/anomalyco/opencode) | 171k | MIT | `opencode run`, `opencode serve`, JS SDK | Built-in GitHub Action with `/opencode` commands, issue triage, PR work, schedule | Best fit. Active, mature, plan/build agents, permission model. |
| [Pi](https://github.com/earendil-works/pi) | 60k | MIT | SDK, RPC mode, JSON event stream | No built-in GitHub issue/PR workflow | Hackable toolkit. Extensions, skills, containerization. Good alternative. |
| [Cline](https://github.com/cline/cline) | 63k | Apache-2.0 | CLI (`cline run`), SDK, headless, scheduled agents | No built-in issue workflow | SDK-first. Could work but less GitHub-native. |
| [Plandex](https://github.com/plandex-ai/plandex) | 15k | MIT | CLI, self-hosted server | No GitHub integration | Plan-first workflow, diff sandbox. Good ideas but own state model. |
| [Aider](https://github.com/Aider-AI/aider) | 46k | Apache-2.0 | CLI only, no SDK/server | No | Terminal pair programmer. Not designed for headless automation. |

### PR/Review Tools (Not Backbone, But Relevant)

| Product | Stars | License | Notes |
|---|---|---|---|
| [PR-Agent](https://github.com/The-PR-Agent/pr-agent) | 11.5k | Apache-2.0 | PR reviewer, not issue-to-implementation. |
| [Probot](https://github.com/probot/probot) | 9.6k | ISC | GitHub App framework in Node.js. Webhook handling, not AI. Ideal orchestrator. |

### Key Findings

- No open-source product implements the exact "admin-approved issue -> plan negotiation -> execute PR" loop.
- OpenHands Resolver is closest but lacks the deliberate plan-review cycle.
- The differentiator is the admin-gated plan workflow, per-task instruction profiles, and 24/7 orchestration.

---

## Architecture Decision

### Three-Layer Architecture

```
+---------------------------+
|   Layer 1: Orchestrator   |  Probot (GitHub App)
|   - Webhook listener      |  - Receives issue/comment/label events
|   - Command parser        |  - Validates admin identity
|   - Label state machine   |  - Manages state transitions
|   - Reconciler cron       |  - Recovers from missed webhooks
+---------------------------+
            |
            v
+---------------------------+
|   Layer 2: Harness        |  OpenCode (primary) / Pi (alternative)
|   - Plan generation       |  - via CodingHarness interface
|   - Plan revision         |  - Swappable implementations
|   - Code execution        |
|   - PR creation           |
+---------------------------+
            |
            v
+---------------------------+
|   Layer 3: Sandbox        |  Docker / firejail / microVM
|   - Isolated workspace    |  - Per-issue ephemeral environment
|   - Resource limits       |  - No long-lived credentials
|   - Network restrictions  |
+---------------------------+
```

### Why This Split

- **Probot** owns GitHub identity, webhook handling, and command parsing. It is mature (9.6k stars), well-documented, and purpose-built for GitHub Apps.
- **OpenCode/Pi** owns the AI planning and coding. Swappable via interface.
- **Sandbox** keeps execution safe. Agent runs arbitrary repo commands.

---

## Harness Selection: OpenCode vs Pi

### Harness Interface

Both harnesses implement the same interface, making them swappable:

```ts
interface CodingHarness {
  proposePlan(issueContext: IssueContext, repoConfig: RepoConfig): Promise<PlanResult>
  revisePlan(issueContext: IssueContext, priorPlan: string, adminFeedback: string): Promise<PlanResult>
  executePlan(issueContext: IssueContext, approvedPlan: string, workspace: string): Promise<ExecutionResult>
}

interface IssueContext {
  issueNumber: number
  issueTitle: string
  issueBody: string
  comments: Comment[]
  labels: string[]
  repoUrl: string
  repoOwner: string
  repoName: string
}

interface RepoConfig {
  taskType: 'bug' | 'feature' | 'docs' | 'ui' | string
  instructions: string
  testCommand?: string
  maxRuntimeMinutes: number
  branchPrefix: string
}

interface PlanResult {
  plan: string           // Markdown plan text
  planVersion: number
  confidence: number     // 0-1
  warnings: string[]
}

interface ExecutionResult {
  success: boolean
  branch: string
  prUrl?: string
  diffSummary: string
  testResults?: string
  errors: string[]
}
```

### OpenCode Implementation Strategy

OpenCode provides:

- `opencode run "<prompt>"` for non-interactive single-shot execution.
- `opencode serve` + `@opencode-ai/sdk` for persistent server with typed API.
- Built-in `plan` agent (read-only, no edits) for plan generation.
- Built-in `build` agent (full access) for execution.
- Agent permissions to enforce plan vs. build boundaries.
- `--dangerously-skip-permissions` for CI/headless automation.

For planning:
```bash
opencode run \
  --agent plan \
  --model anthropic/claude-sonnet-4-20250514 \
  "Given this issue: <issue_body>. Propose an implementation plan. Do not make changes."
```

For execution:
```bash
opencode run \
  --agent build \
  --model anthropic/claude-sonnet-4-20250514 \
  --dangerously-skip-permissions \
  "Execute this approved plan: <plan_text>"
```

Or via SDK for more control:
```ts
import { createOpencode } from "@opencode-ai/sdk"

const { client } = await createOpencode({ port: 4096 })
const session = await client.session.create({ body: { title: `Issue #${issueNumber}` } })
const result = await client.session.prompt({
  path: { id: session.data.id },
  body: {
    agent: "plan",
    parts: [{ type: "text", text: planPrompt }],
  },
})
```

### Pi Implementation Strategy

Pi provides:

- `pi` CLI with non-interactive mode.
- SDK (`@earendil-works/pi-agent-core`) for programmatic use.
- RPC mode (stdin/stdout JSONL) for process-level integration.
- JSON event stream mode for structured output.
- Extensions and skills for custom tools.
- Containerization via OpenShell, Gondolin, or Docker.

For planning:
```ts
import { Agent } from "@earendil-works/pi-agent-core"

const agent = new Agent({ /* config */ })
const result = await agent.run(planPrompt)
```

### When to Choose Each

| Criteria | OpenCode | Pi |
|---|---|---|
| Fastest to MVP | Yes | No |
| Built-in plan/build agents | Yes | No (custom) |
| Built-in GitHub awareness | Yes | No |
| Permission model | Yes (granular) | No (external sandbox) |
| Extensibility/hackability | Good (plugins, agents, skills) | Better (TS extensions, custom tools) |
| Runtime model | Server + SDK | SDK + RPC |
| Sandbox | External | External (Gondolin/Docker docs) |

**Recommendation**: Start with OpenCode. Keep Pi as fallback behind the `CodingHarness` interface.

---

## Orchestrator: Probot

### Why Probot

- Purpose-built TypeScript framework for GitHub Apps.
- Handles webhook verification, authentication, rate limiting.
- Event-driven: `app.on("issues.labeled", ...)`, `app.on("issue_comment.created", ...)`.
- Mature (9.6k stars, 1k forks), well-documented.
- Runs as a standard Node.js server on any Linux box.

### GitHub App Identity

Register a GitHub App (not a personal bot account):

- Posts comments, creates branches, opens PRs as a distinct bot identity.
- Granular permissions: issues (read/write), pull requests (read/write), contents (read/write).
- Webhook subscriptions: `issues`, `issue_comment`, `pull_request`, `label`.
- Installation tokens (short-lived, per-repo) instead of long-lived PATs.

### Probot Skeleton

```ts
import { Probot } from "probot"

export default (app: Probot) => {
  // Admin comments /agent plan, /agent approve, etc.
  app.on("issue_comment.created", async (context) => {
    const comment = context.payload.comment
    const issue = context.payload.issue

    const command = parseCommand(comment.body)
    if (!command) return

    // Check authorization (direct repo permission + issue delegation)
    const authorized = await isAuthorized(context, command.action)
    if (!authorized) {
      await context.octokit.issues.createComment(
        context.issue({ body: `@${context.payload.sender.login} You don't have permission to run \`/agent ${command.action}\`. Required: \`admin\` or \`maintain\` repo permission, or an active delegation for this issue.` })
      )
      return
    }

    switch (command.action) {
      case "plan":
        await handlePlan(context, issue, command)
        break
      case "revise":
        await handleRevise(context, issue, command)
        break
      case "approve":
        await handleApprove(context, issue, command)
        break
      case "stop":
        await handleStop(context, issue, command)
        break
      case "retry":
        await handleRetry(context, issue, command)
        break
      case "delegate":
        await handleDelegate(context, issue, command)
        break
      case "undelegate":
        await handleUndelegate(context, issue, command)
        break
      case "delegates":
        await handleListDelegates(context, issue)
        break
    }
  })

  // Admin adds agent:ready label
  app.on("issues.labeled", async (context) => {
    const label = context.payload.label?.name
    if (label !== "agent:ready") return
    const authorized = await isAuthorized(context, "plan")
    if (authorized) {
      // Optionally auto-start planning
    }
  })
}

// Commands that require full admin/maintain permission (no delegation)
const ADMIN_ONLY_COMMANDS = ["delegate", "undelegate", "stop"]
// Commands that can be delegated
const DELEGATABLE_COMMANDS = ["plan", "revise", "approve", "run", "retry"]
// Commands available to anyone
const PUBLIC_COMMANDS = ["status", "delegates"]

async function isAuthorized(context: any, command: string): Promise<boolean> {
  // Public commands are always allowed
  if (PUBLIC_COMMANDS.includes(command)) return true

  const sender = context.payload.sender.login
  const { owner, repo } = context.repo()

  // 1. Check direct repo permission via collaborator API
  const repoConfig = await loadRepoConfig(context)
  const requiredPermissions = repoConfig?.approval?.required_permissions ?? ["admin", "maintain"]
  const allowedUsers = repoConfig?.approval?.allowed_users ?? []

  // Explicit allowlist
  if (allowedUsers.includes(sender)) return true

  try {
    const { data } = await context.octokit.repos.getCollaboratorPermissionLevel({
      owner, repo, username: sender,
    })
    const permission = data.permission // "admin" | "maintain" | "write" | "triage" | "read"
    if (requiredPermissions.includes(permission)) return true
  } catch {
    // User may not be a collaborator at all
  }

  // 2. Admin-only commands cannot be delegated
  if (ADMIN_ONLY_COMMANDS.includes(command)) return false

  // 3. Check issue-scoped delegation
  if (DELEGATABLE_COMMANDS.includes(command)) {
    const delegations = await getActiveDelegations(context, context.payload.issue.number)
    const match = delegations.find(
      (d) => d.delegated_to === sender && d.scopes.includes(command)
    )
    if (match) {
      // Verify delegated user has minimum repo permission
      const minPermission = repoConfig?.approval?.delegation?.min_delegate_permission ?? "write"
      try {
        const { data } = await context.octokit.repos.getCollaboratorPermissionLevel({
          owner, repo, username: sender,
        })
        return permissionAtLeast(data.permission, minPermission)
      } catch {
        return false
      }
    }
  }

  return false
}

function parseCommand(body: string): Command | null {
  const match = body.match(/\/agent\s+(plan|revise|approve|run|stop|retry|delegate|undelegate|delegates|status)(?:\s+(.*))?/i)
  if (!match) return null
  return { action: match[1].toLowerCase(), args: match[2]?.trim() || "" }
}
```

### Reconciler Cron

A periodic job (every 5-15 minutes) scans for stale states:

```ts
// Pseudo-code
async function reconcile(app: Probot) {
  const repos = getInstalledRepos()
  for (const repo of repos) {
    const issues = await listIssuesWithLabel(repo, "agent:planning")
    for (const issue of issues) {
      const lastBotComment = await getLastBotComment(issue)
      if (isStale(lastBotComment, 30 * 60 * 1000)) {
        // Planning started > 30 min ago with no result
        await markBlocked(issue, "Planning timed out")
      }
    }
    // Similar checks for agent:working, agent:approved
  }
}

setInterval(() => reconcile(app), 10 * 60 * 1000) // every 10 min
```

---

## GitHub Integration

### Bot Identity

- Register a GitHub App at https://github.com/settings/apps.
- The app gets its own identity: avatar, name, description.
- All comments, commits, and PRs from the bot show the app's identity.
- Use installation tokens for API calls (auto-scoped to installed repos).

### Authorization and Delegation

#### Permission Model

Admin status is determined by **GitHub repository permission**, not only by issue comment `author_association`.

The bot calls GitHub's collaborator permission API for the command sender:

```http
GET /repos/{owner}/{repo}/collaborators/{username}/permission
```

This returns one of: `admin`, `maintain`, `write`, `triage`, `read`.

Default command authorization by permission level:

| Permission | Allowed Commands |
|---|---|
| `admin` | All commands, including delegation and configuration |
| `maintain` | Full agent workflow (`plan`, `approve`, `run`, `stop`, `retry`, `delegate`) |
| `write` | `plan`, `revise`, `status` (if configured; not by default) |
| `triage` / `read` | `status` only |

> **Why not `author_association`?**
> The `author_association` field on issue comments (`OWNER`, `MEMBER`, `COLLABORATOR`) is a loose signal. `MEMBER` means the user belongs to the org but says nothing about their repo-level access. `COLLABORATOR` may include users with read-only access. For `issues.labeled` events, there is no `author_association` at all -- only a `sender` object. The collaborator permission API is the source of truth.
>
> `author_association` can be used as a fast-path optimization (skip API call if association is `NONE`), but must not be the sole check.

#### Delegation

Delegation allows an authorized admin or maintainer to grant **issue-scoped** agent permissions to another user who would not otherwise have sufficient repo-level permission.

##### Delegation Commands

| Command | Effect |
|---|---|
| `/agent delegate @user` | Delegate full workflow permissions (`plan`, `revise`, `approve`, `run`) for this issue |
| `/agent delegate @user plan` | Delegate planning/revision only |
| `/agent delegate @user approve` | Delegate plan approval only |
| `/agent delegate @user run` | Delegate execution only |
| `/agent undelegate @user` | Revoke all delegations for this user on this issue |
| `/agent delegates` | List active delegations for this issue |

##### Delegation Storage

Since the system uses GitHub as its durable state store (no database), delegations are stored as bot metadata comments on the issue:

```md
<!-- agent-metadata
{
  "kind": "delegation",
  "issue": 123,
  "delegated_by": "repo-admin",
  "delegated_to": "alice",
  "scopes": ["plan", "revise", "approve", "run"],
  "created_at": "2026-06-06T12:00:00Z",
  "expires_at": null,
  "revoked_at": null
}
-->

Delegated agent permissions to @alice for this issue (scopes: plan, revise, approve, run).
```

Revocation updates the existing metadata comment by setting `revoked_at`.

##### Authorization Flow

1. Fetch the sender's repo permission via the collaborator API.
2. If the sender has sufficient direct permission for the command, authorize.
3. If not, scan the issue's bot metadata comments for active (non-revoked, non-expired) delegation entries where `delegated_to` matches the sender.
4. Check that the delegation's `scopes` include the requested command.
5. If no direct permission and no valid delegation, reject with a comment explaining the required permission.

##### Delegation Constraints

- Only users with `admin` or `maintain` permission can delegate.
- Delegated users must have at least `write` (or a configurable minimum) repo permission. This prevents delegating to anonymous users or those with no repo access.
- Delegated users **cannot** delegate to others unless `allow_delegate_chaining` is explicitly enabled in repo config.
- Delegation is scoped to a single issue. It does not carry over to other issues.
- Delegation can optionally expire (`expires_at` field).

### Webhook Events

| Event | Use |
|---|---|
| `issue_comment.created` | Parse `/agent` commands. |
| `issues.labeled` | Detect `agent:ready` or type labels. |
| `issues.unlabeled` | Detect manual state resets. |
| `pull_request.closed` | Detect merged PRs to transition to `agent:done`. |
| `pull_request_review` | Optionally react to PR review feedback. |

### Webhook vs. Polling

- **Primary**: Webhooks via Probot (near real-time, low overhead).
- **Fallback**: Reconciler cron every 5-15 minutes scans for missed events, stale states, stuck jobs.
- **No pure polling needed** if webhooks are configured correctly, but the reconciler provides resilience.

---

## State Machine (Label-Based)

### Principle

> GitHub is the durable state store; the server is a stateless/recoverable worker.

- **Labels** = current state and routing.
- **Bot comments** = plans, approvals, execution logs, PR links, structured metadata.
- **PR links** = execution artifacts.
- **Server memory** = only transient runtime state (in-memory job queue).
- **Reconciler** = recovers from missed webhooks or process restarts by scanning labels.

### Core State Labels

Use exactly one `agent:` state label at a time:

| Label | Meaning |
|---|---|
| `agent:ready` | Admin has confirmed this issue is ready for agent work. |
| `agent:planning` | Bot has claimed the issue and is generating/revising a plan. |
| `agent:plan-review` | Bot posted a plan; waiting for admin feedback/approval. |
| `agent:approved` | Admin approved the current plan for execution. |
| `agent:working` | Bot is implementing the approved plan. |
| `agent:pr-opened` | Bot opened a PR linked to the issue. |
| `agent:blocked` | Bot cannot proceed without human input. |
| `agent:done` | Work completed/merged or issue resolved. |
| `agent:cancelled` | Admin stopped the agent flow. |

### Classification Labels (Coexist With State)

| Label | Purpose |
|---|---|
| `agent:type:bug` | Apply bug-fix instructions. |
| `agent:type:feature` | Apply feature implementation instructions. |
| `agent:type:docs` | Apply documentation instructions. |
| `agent:type:ui` | Apply UI/component replication instructions. |
| `agent:needs-admin` | Waiting for authorized maintainer response. |
| `agent:needs-info` | Issue lacks enough detail to proceed. |
| `agent:retryable` | Last failure may be retried. |

### State Transition Table

| From | Trigger | To |
|---|---|---|
| (none) | Admin adds `agent:ready` or comments `/agent plan` | `agent:planning` |
| `agent:planning` | Plan generated successfully | `agent:plan-review` |
| `agent:planning` | Plan generation fails | `agent:blocked` |
| `agent:plan-review` | Admin comments `/agent revise <feedback>` | `agent:planning` |
| `agent:plan-review` | Admin comments `/agent approve` | `agent:approved` |
| `agent:approved` | Worker claims job | `agent:working` |
| `agent:working` | PR opened | `agent:pr-opened` |
| `agent:working` | Execution fails, needs input | `agent:blocked` |
| `agent:blocked` | Admin comments `/agent retry` | Previous state |
| `agent:pr-opened` | PR merged or issue closed | `agent:done` |
| Any active state | Admin comments `/agent stop` | `agent:cancelled` |

### Commands

| Command | Authorization | Effect |
|---|---|---|
| `/agent plan` | Admin/Maintainer or delegated | Start planning. Adds `agent:planning`. |
| `/agent revise <feedback>` | Admin/Maintainer or delegated | Re-plan with feedback. Keeps `agent:planning`. |
| `/agent approve` | Admin/Maintainer or delegated | Approve plan. Transitions to `agent:approved`. |
| `/agent run` | Admin/Maintainer or delegated | Approve + execute (shortcut). |
| `/agent stop` | Admin/Maintainer only | Cancel. Adds `agent:cancelled`. |
| `/agent retry` | Admin/Maintainer or delegated | Retry from `agent:blocked`. |
| `/agent delegate @user [scope]` | Admin/Maintainer only | Grant issue-scoped permissions to user. |
| `/agent undelegate @user` | Admin/Maintainer only | Revoke issue-scoped permissions. |
| `/agent delegates` | Anyone | List active delegations for this issue. |
| `/agent status` | Anyone | Bot replies with current state summary. |

### Claiming Without a DB

Concurrency handling via labels and idempotency:

1. On webhook, fetch current issue labels fresh (not from webhook payload cache).
2. If issue is not in an expected state for the transition, do nothing.
3. Apply the new state label via GitHub API.
4. After label change, fetch issue again to confirm state.
5. Proceed only if label state matches expected claim.
6. Before posting output, re-check for newer admin commands that may have changed state.

For single-instance Probot deployment, this is sufficient. For multi-replica, add a comment-based lock:

```md
<!-- agent-lock {"worker":"worker-1","claimed_at":"2026-06-06T12:00:00Z"} -->
```

### Bot Comments as Durable Metadata

Labels carry state; comments carry payload. Use hidden HTML comments for machine-readable metadata:

```md
<!-- agent-metadata
{
  "kind": "plan",
  "plan_version": 3,
  "issue": 123,
  "state": "agent:plan-review",
  "harness": "opencode",
  "model": "anthropic/claude-sonnet-4-20250514",
  "created_at": "2026-06-06T12:00:00Z"
}
-->

## Proposed Plan (v3)

### Summary
Brief description of what will be done.

### Steps
1. Step one...
2. Step two...
3. Step three...

### Files to Modify
- `src/foo.ts` - Add error handling
- `src/bar.ts` - New function

### Testing Strategy
- Add unit tests for...
- Run existing test suite

---
*Generated by GitAgent using OpenCode. Reply with `/agent approve` to proceed or `/agent revise <feedback>` to iterate.*
```

This lets the bot reconstruct:

- Latest plan version (match approval to correct plan).
- Which harness and model produced the result.
- Execution branch and PR link.
- Last failure reason.

---

## Configuration Model

### Per-Repository Configuration

Each repo can include a `.github/gitagent.yml` file:

```yaml
# .github/gitagent.yml

enabled: true

# Labels that mark an issue as ready for agent work
ready_labels:
  - agent:ready

# Who can control agent work
approval:
  # GitHub repo permission levels (from collaborator API)
  required_permissions:
    - admin
    - maintain
  # Specific users always authorized (in addition to permission check)
  allowed_users: []
  # Delegation settings
  delegation:
    enabled: true
    # Minimum repo permission to delegate to others
    min_delegator_permission: maintain
    # Minimum repo permission a delegated user must have
    min_delegate_permission: write
    # Whether delegated users can delegate further
    allow_delegate_chaining: false

# Task-type specific instructions
tasks:
  bug:
    labels: [bug, agent:type:bug]
    instructions: |
      Focus on minimal, targeted changes.
      Always add a regression test.
      Prefer fixing the root cause over workarounds.
      Do not refactor unrelated code.

  feature:
    labels: [enhancement, agent:type:feature]
    instructions: |
      Propose the API/UX behavior first in the plan.
      Follow existing code patterns and conventions.
      Add documentation for new public APIs.
      Include unit tests.

  docs:
    labels: [documentation, agent:type:docs]
    instructions: |
      Use clear, concise language.
      Include code examples where relevant.
      Follow existing documentation style.

  ui:
    labels: [ui, agent:type:ui]
    instructions: |
      Match visual behavior of reference.
      Include screenshots or visual diffs if possible.
      Follow existing component patterns.

# Execution settings
execution:
  harness: opencode          # or "pi"
  model: anthropic/claude-sonnet-4-20250514
  plan_model: anthropic/claude-sonnet-4-20250514  # can differ from exec model
  test_command: auto          # "auto" = let agent decide, or explicit command
  max_runtime_minutes: 60
  branch_prefix: agent/
  auto_run_tests: true
  max_plan_revisions: 5

# Sandbox settings
sandbox:
  type: docker                # docker | firejail | none
  image: node:20-slim         # base image for workspace
  network: restricted         # restricted | none | host
  memory_limit: 4g
  cpu_limit: 2
```

### Default Configuration

If no `.github/gitagent.yml` exists, use sensible defaults:

- Users with `admin` or `maintain` repo permission are authorized.
- Delegation enabled; delegated users must have at least `write` permission.
- No task-type-specific instructions (generic prompt).
- OpenCode harness.
- 60-minute max runtime.
- Docker sandbox if available, otherwise none.
- `agent/` branch prefix.

---

## Feasibility & Risks

### Feasible (Low Risk)

| Area | Notes |
|---|---|
| GitHub App / Probot | Well-documented, mature framework. Straightforward. |
| Webhook handling | Standard Probot capability. |
| Label-based state | GitHub API supports label CRUD. No DB needed. |
| Bot comments | GitHub API supports creating/editing comments. |
| OpenCode headless | `opencode run` and SDK are documented and functional. |
| Branch/PR creation | Standard GitHub API via Octokit. |

### Moderate Risk

| Area | Risk | Mitigation |
|---|---|---|
| Safe execution | Agent runs arbitrary repo commands | Docker sandbox, resource limits, no long-lived creds, ephemeral workspaces. |
| Plan quality | LLM may produce poor plans | Admin review loop, max revision limit, confidence scoring. |
| Concurrency | Two webhooks for same issue | Label-based idempotent claiming, single-instance deployment for MVP. |
| Cost control | LLM calls can be expensive | Max runtime, max iterations, per-issue budget tracking in comments. |
| Prompt injection | Issue text is untrusted | Treat issue body as task input, not system instruction. Keep bot policy outside issue content. |
| State sync | Missed webhooks | Reconciler cron every 5-15 minutes. |

### Hard Problems

| Area | Difficulty | Notes |
|---|---|---|
| Plan iteration UX | Medium | Strict comment markers and command parsing to avoid duplicate plans or stale approvals. Plan versioning in metadata comments. |
| Quality control | Medium | Generated PRs need tests, lint, diff summary. May need automated PR self-review before notifying maintainers. |
| Multi-repo | Low-Medium | GitHub App supports multiple installations. Config is per-repo. State is per-issue. |
| OpenCode on headless Linux | Low | Runs on Linux, installable via npm or curl. No GUI needed. |

---

## MVP Scope

### In Scope (v0.1)

- [ ] Probot-based GitHub App, deployed on a single Linux server.
- [ ] Webhook listener for `issue_comment.created` and `issues.labeled`.
- [ ] Command parser for `/agent plan`, `/agent approve`, `/agent revise`, `/agent stop`, `/agent delegate`, `/agent undelegate`, `/agent delegates`, `/agent status`.
- [ ] Permission-based authorization using GitHub collaborator permission API.
- [ ] Issue-scoped delegation via `/agent delegate` with metadata comment storage.
- [ ] Label-based state machine (9 core labels).
- [ ] OpenCode harness via `opencode run` (plan agent + build agent).
- [ ] Bot posts plan as a comment with metadata.
- [ ] Bot creates branch, commits changes, opens PR on approval.
- [ ] Per-repo `.github/gitagent.yml` config.
- [ ] Docker-based sandbox for execution.
- [ ] Reconciler cron (every 10 minutes).
- [ ] Single task-type instruction set.

### Out of Scope (v0.2+)

- [ ] Pi harness implementation.
- [ ] Multiple task-type instruction profiles.
- [ ] PR self-review before notifying admin.
- [ ] Cost tracking and per-issue budgets.
- [ ] Multi-replica deployment with distributed locking.
- [ ] Web dashboard for monitoring agent status.
- [ ] Slack/Discord notifications.
- [ ] Auto-retry on transient failures.
- [ ] PR review feedback loop (agent responds to PR review comments).
- [ ] Delegation chaining (delegated users delegating further).
- [ ] Time-based delegation expiry enforcement.

### Tech Stack (MVP)

| Component | Technology |
|---|---|
| Orchestrator | Probot (TypeScript, Node.js) |
| Coding harness | OpenCode (`opencode run` / SDK) |
| Sandbox | Docker (per-issue containers) |
| State store | GitHub labels + comments (no DB) |
| Deployment | Single Linux server, systemd service |
| Config | `.github/gitagent.yml` per repo |

### Directory Structure (Proposed)

```
gitagent/
├── src/
│   ├── index.ts                 # Probot app entry
│   ├── commands/
│   │   ├── parser.ts            # Parse /agent commands from comments
│   │   ├── plan.ts              # Handle /agent plan
│   │   ├── approve.ts           # Handle /agent approve
│   │   ├── revise.ts            # Handle /agent revise
│   │   ├── stop.ts              # Handle /agent stop
│   │   └── retry.ts             # Handle /agent retry
│   ├── state/
│   │   ├── labels.ts            # Label state machine
│   │   ├── transitions.ts       # State transition logic
│   │   └── reconciler.ts        # Periodic state reconciliation
│   ├── harness/
│   │   ├── interface.ts         # CodingHarness interface
│   │   ├── opencode.ts          # OpenCode implementation
│   │   └── pi.ts                # Pi implementation (stub)
│   ├── github/
│   │   ├── auth.ts              # Permission-based authorization checks
│   │   ├── delegation.ts        # Issue-scoped delegation management
│   │   ├── comments.ts          # Bot comment creation/parsing
│   │   ├── branches.ts          # Branch creation
│   │   └── pull-requests.ts     # PR creation
│   ├── sandbox/
│   │   ├── docker.ts            # Docker sandbox management
│   │   └── workspace.ts         # Ephemeral workspace setup
│   ├── config/
│   │   ├── loader.ts            # Load .github/gitagent.yml
│   │   ├── schema.ts            # Config validation
│   │   └── defaults.ts          # Default configuration
│   └── utils/
│       ├── metadata.ts          # Parse/write HTML metadata comments
│       └── logger.ts            # Structured logging
├── tests/
│   ├── commands/
│   ├── state/
│   ├── harness/
│   └── fixtures/
├── Documentation/
│   └── plans/
│       └── PLAN.md              # This file
├── .github/
│   └── gitagent.yml             # Self-referential config for this repo
├── Dockerfile                   # For deployment
├── docker-compose.yml           # For local dev with sandbox
├── package.json
├── tsconfig.json
├── README.md
└── .gitignore
```
