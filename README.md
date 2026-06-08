# AgentGit

A GitHub bot that watches repositories for issues, proposes AI-generated implementation plans, iterates with maintainers, and opens pull requests -- all driven by `/agent` commands in issue comments.

AgentGit runs as an outbound-only polling service using a [GitHub App](https://docs.github.com/en/apps/creating-github-apps) identity. It uses [OpenCode](https://github.com/anomalyco/opencode) as the AI coding harness for plan generation and code execution. All state is stored in GitHub labels and comments -- no external database required. **No inbound webhooks, no public ports, no exposed servers.**

## Table of Contents

- [How It Works](#how-it-works)
- [Architecture](#architecture)
- [Commands](#commands)
- [State Machine](#state-machine)
- [Security Model](#security-model)
- [Task Workflow System](#task-workflow-system)
- [Configuration](#configuration)
- [Installation](#installation)
- [Development](#development)
- [Project Structure](#project-structure)
- [Build Status](#build-status)

---

## How It Works

1. A maintainer creates a GitHub issue describing a bug, feature, or task.
2. The maintainer comments `/agent plan` (or adds the `agent:ready` label).
3. AgentGit's polling loop picks up the command and runs a **safety review** on the issue content.
4. If safe, AgentGit **classifies the issue** and **generates an implementation plan** using the AI harness.
5. The plan is posted as a signed comment on the issue for review.
6. The maintainer reviews the plan and either:
   - Comments `/agent approve` to proceed.
   - Comments `/agent revise <feedback>` to request changes.
7. Once approved, AgentGit **clones the repo**, **executes the plan**, **runs tests**, and **opens a PR** linked to the issue.
8. When the PR is merged, the poller detects it and marks the issue as done.

```
Issue Created
    |
    v
/agent plan  -->  Safety Review  -->  Plan Generation  -->  Plan Posted
                       |                                         |
                   (unsafe)                              /agent approve
                       |                                         |
                  Security Lock                          Build + Test + PR
                       |                                         |
                 Admin Unlock                              PR Merged
                       |                                         |
                   Planning                                   Done
```

---

## Architecture

AgentGit uses a three-layer architecture with an **outbound-only** design. The AgentGit process never exposes a public port or receives inbound connections. It polls the GitHub API for new activity.

### Layer 1: Polling Controller

The polling controller periodically scans all installed repositories for actionable state:

- **New commands**: Unprocessed `/agent` comments on open issues.
- **Ready issues**: Issues with `agent:ready` label that haven't been started.
- **Merged PRs**: PRs created by AgentGit that were merged (to transition issues to done).
- **Stale issues**: Issues stuck in active states (planning, working) past a timeout threshold.

Each processed command gets a signed receipt comment to prevent duplicate processing across poll cycles or multiple workers.

### Layer 2: Task Engine

Work is organized as **tasks**, each composed of ordered **phases**. Each phase invokes a **skill** -- a reusable unit of work with defined inputs and outputs. Four default tasks ship with AgentGit:

| Task | Purpose | Phases |
|---|---|---|
| `pre-plan` | Safety gate before planning | `task-safety-checker` |
| `plan` | Generate implementation plan | `issue-classifier` -> `plan-generator` |
| `build` | Execute the approved plan | `workspace-setup` -> `plan-executor` |
| `post-build` | Validate and open PR | `test-runner` -> `docs-checker` -> `lint-runner` -> `pr-creator` |

### Layer 3: Coding Harness (OpenCode)

OpenCode provides the AI planning and coding capabilities. It is invoked by specific skills, not directly by the orchestrator. The harness is swappable via the `CodingHarness` interface (Pi is stubbed as an alternative).

- **Planning**: `opencode run --agent plan --model <model> '<prompt>'`
- **Execution**: `opencode run --agent build --model <model> --dangerously-skip-permissions '<prompt>'`

---

## Commands

All commands are issued as comments on GitHub issues with the `/agent` prefix.

### Workflow Commands

| Command | Authorization | Description |
|---|---|---|
| `/agent plan` | Admin/Maintain or delegated | Start planning. Runs safety review first. |
| `/agent revise <feedback>` | Admin/Maintain or delegated | Re-generate plan with feedback. |
| `/agent approve` | Admin/Maintain or delegated | Approve the current plan for execution. |
| `/agent run` | Admin/Maintain or delegated | Approve + execute (shortcut). |
| `/agent stop` | Admin/Maintain only | Cancel the agent workflow. |
| `/agent retry` | Admin/Maintain or delegated | Retry from a blocked state. |

### Delegation Commands

| Command | Authorization | Description |
|---|---|---|
| `/agent delegate @user` | Admin/Maintain only | Grant full workflow permissions for this issue. |
| `/agent delegate @user plan approve` | Admin/Maintain only | Grant specific scope(s) only. |
| `/agent undelegate @user` | Admin/Maintain only | Revoke delegated permissions. |
| `/agent delegates` | Anyone | List active delegations for this issue. |

### Security Commands

| Command | Authorization | Description |
|---|---|---|
| `/agent unlock-security` | Admin or `security_admins` | Unlock a security-locked issue. |
| `/agent close-unsafe` | Admin or `security_admins` | Close the issue as unsafe. |
| `/agent security-status` | Anyone | Show the safety review result. |

### Informational Commands

| Command | Authorization | Description |
|---|---|---|
| `/agent status` | Anyone | Show current state summary. |

---

## State Machine

AgentGit tracks issue state using exactly one `agent:*` label at a time. All state transitions are deterministic and validated by the state machine.

### State Labels

| Label | Color | Meaning |
|---|---|---|
| `agent:ready` | Green | Issue is ready for agent work. |
| `agent:security-review` | Red-orange | Safety review in progress. |
| `agent:locked-security` | Dark red | Failed safety review. Locked. |
| `agent:planning` | Blue | Generating/revising a plan. |
| `agent:plan-review` | Purple | Plan posted, awaiting feedback. |
| `agent:approved` | Green | Plan approved for execution. |
| `agent:working` | Yellow | Implementing the plan. |
| `agent:pr-opened` | Dark blue | PR opened, linked to issue. |
| `agent:blocked` | Red-orange | Needs human input to proceed. |
| `agent:done` | Gray | Work completed/merged. |
| `agent:cancelled` | Gray | Workflow cancelled. |

### Classification Labels (coexist with state labels)

| Label | Description |
|---|---|
| `agent:type:bug` | Bug fix task. |
| `agent:type:feature` | Feature implementation. |
| `agent:type:docs` | Documentation task. |
| `agent:type:ui` | UI replication task. |
| `agent:needs-admin` | Waiting for admin. |
| `agent:needs-info` | Issue lacks detail. |
| `agent:retryable` | Failure is retryable. |

### Transition Table

| From | Trigger | To |
|---|---|---|
| *(none)* / `agent:ready` | `/agent plan` or `agent:ready` label | `agent:security-review` |
| `agent:security-review` | Safety review passes | `agent:planning` |
| `agent:security-review` | Safety review fails | `agent:locked-security` |
| `agent:locked-security` | `/agent unlock-security` | `agent:planning` |
| `agent:locked-security` | `/agent close-unsafe` | *(issue closed)* |
| `agent:planning` | Plan generated | `agent:plan-review` |
| `agent:planning` | Plan failed | `agent:blocked` |
| `agent:plan-review` | `/agent revise` | `agent:planning` |
| `agent:plan-review` | `/agent approve` | `agent:approved` |
| `agent:approved` | Work starts | `agent:working` |
| `agent:working` | Build + PR succeed | `agent:pr-opened` |
| `agent:working` | Build fails | `agent:blocked` |
| `agent:blocked` | `/agent retry` | `agent:planning` |
| `agent:pr-opened` | PR merged | `agent:done` |
| *(any active state)* | `/agent stop` | `agent:cancelled` |
| `agent:cancelled` | `/agent plan` | `agent:security-review` |

---

## Security Model

### Pre-Plan Safety Gate

Every issue passes through a safety review before the agent begins planning. The `task-safety-checker` skill scans the issue title, body, and comments against 39 deterministic regex rules across 6 disallowed categories:

| Category | Rules | Examples |
|---|---|---|
| `credential_theft` | 8 | "print env vars", "send .env", "process.env" |
| `malware` | 7 | "reverse shell", "backdoor", "keylogger" |
| `data_exfiltration` | 6 | "upload to external", "exfiltrate", "curl secret" |
| `abuse` | 5 | "spam", "open 1000 issues", "DDoS" |
| `policy_bypass` | 6 | "disable branch protection", "skip CI", "remove CODEOWNERS" |
| `destructive_change` | 7 | "delete all", "rm -rf", "drop database", "force-push to main" |

If a pattern matches with confidence >= 0.5, the issue is locked (`agent:locked-security`) and requires admin action to proceed.

### Authorization

Authorization is based on **GitHub repository permissions** via the collaborator API (`GET /repos/{owner}/{repo}/collaborators/{username}/permission`), not `author_association`.

| Permission Level | Allowed Commands |
|---|---|
| `admin` | All commands including delegation and security |
| `maintain` | Full workflow + delegation |
| `write` | Only if delegated |
| `triage` / `read` | Public commands only (`status`, `delegates`, `security-status`) |

### Delegation

Admins and maintainers can delegate issue-scoped permissions to other users:

- Delegations are stored as signed metadata comments on the issue.
- Delegated users must have at least `write` repository permission.
- Delegation is per-issue, not repo-wide.
- Admin-only commands (`stop`, `delegate`, `undelegate`) cannot be delegated.

### Metadata Signing

All bot metadata comments (plans, delegations, security locks, command receipts) are signed with HMAC-SHA256 using a server-side secret. The bot verifies:

1. Comment author is the app bot (`<app-slug>[bot]` with `type: "Bot"`).
2. HMAC signature in the metadata matches a fresh computation.

This prevents spoofing of bot metadata by regular users.

### Command Receipt System

Each processed `/agent` command gets a signed receipt comment to prevent duplicate processing. This enables:

- **Idempotent polling**: Multiple poll cycles safely skip already-processed commands.
- **Multi-worker safety**: Multiple AgentGit instances can poll the same repos without duplicating work.

---

## Task Workflow System

Tasks are defined in YAML files under `.agentGit/tasks/` (or the built-in defaults). Each task has ordered phases, each phase invokes a registered skill.

See the `src/tasks/defaults/` directory for the built-in task definitions.

---

## Configuration

### Repository Config (`.agentGit/config.yml`)

```yaml
enabled: true

ready_labels:
  - agent:ready

approval:
  required_permissions: [admin, maintain]
  allowed_users: []
  delegation:
    enabled: true
    min_delegator_permission: maintain
    min_delegate_permission: write
    allow_delegate_chaining: false

security:
  pre_plan_check:
    enabled: true
    lock_on_unsafe: true
    admin_unlock_required: true
  security_admins: []
  disallowed_categories:
    - credential_theft
    - malware
    - data_exfiltration
    - abuse
    - policy_bypass
    - destructive_change

execution:
  harness: opencode
  model: anthropic/claude-sonnet-4-20250514
  plan_model: anthropic/claude-sonnet-4-20250514
  test_command: auto              # "auto" = let agent decide
  max_runtime_minutes: 60
  branch_prefix: agent/
  auto_run_tests: true
  max_plan_revisions: 5

execution_environment:
  workspace_root: /tmp/agentgit
  cleanup_on_success: true
  cleanup_on_failure: false
```

### Environment Variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `GITHUB_APP_ID` | Yes | -- | GitHub App numeric ID. |
| `GITHUB_APP_PRIVATE_KEY` or `GITHUB_APP_PRIVATE_KEY_PATH` | Yes | -- | App authentication key. |
| `AGENTGIT_SIGNING_SECRET` | Yes | -- | HMAC signing of metadata comments. |
| `AGENTGIT_POLL_INTERVAL_MS` | No | `30000` | Polling interval in milliseconds. |
| `AGENTGIT_LOG_LEVEL` | No | `info` | Log verbosity (`debug`, `info`, `warn`, `error`). |
| `AGENTGIT_WORKER_ID` | No | auto | Unique ID for this worker instance. |
| `GITHUB_APP_SLUG` | No | `agentgit` | App slug for bot identity checks. |
| `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` | Yes (one) | -- | LLM provider API key. |

---

## Installation

### Prerequisites

- Node.js >= 18
- Git >= 2.30
- [OpenCode](https://github.com/anomalyco/opencode) installed and on PATH
- A registered [GitHub App](https://docs.github.com/en/apps/creating-github-apps)

### 1. Register a GitHub App

Go to [github.com/settings/apps](https://github.com/settings/apps) and create a new app with:

**Permissions:**

| Permission | Access |
|---|---|
| Issues | Read & Write |
| Pull requests | Read & Write |
| Contents | Read & Write |
| Metadata | Read |

**Important:** No webhook URL is needed. AgentGit uses outbound polling, not inbound webhooks. You can leave the webhook URL blank or set it to a placeholder. Uncheck "Active" under the Webhook section if GitHub requires a URL.

Generate and download a private key (`.pem` file).

### 2. Clone and Install

```bash
git clone https://github.com/cescofry/AgentGit.git
cd AgentGit
npm install
```

### 3. Configure the Server

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```env
GITHUB_APP_ID=123456
GITHUB_APP_PRIVATE_KEY_PATH=/path/to/private-key.pem
AGENTGIT_SIGNING_SECRET=a-long-random-secret-for-hmac
ANTHROPIC_API_KEY=sk-ant-...
```

### 4. Set Up a Repository

Run the setup wizard:

```bash
npm run setup:repo
```

Or manually:

1. Install the GitHub App on the target repository.
2. Create the `.agentGit/config.yml` file (see [Configuration](#configuration)).
3. The 18 `agent:*` labels are created automatically on first use or via:

```bash
npm run doctor
```

### 5. Start the Polling Service

```bash
# Development
npm run dev

# Production
npm run build
npm start
```

AgentGit will start polling all installed repositories for `/agent` commands. No public port is opened -- the service only makes outbound HTTPS requests to the GitHub API.

### 6. Verify

```bash
npm run doctor
```

Expected output:

```
  Server Environment
  [+] Node.js v20.x.x
  [+] Git v2.x.x
  [+] GITHUB_APP_ID set
  [+] GITHUB_APP_PRIVATE_KEY_PATH set
  [+] AGENTGIT_SIGNING_SECRET set

  Repository
  [+] .agentGit/config.yml exists

  18/18 checks passed, 0 warnings, 0 failures
```

### Multiple Workers

AgentGit supports running multiple worker instances polling the same repositories. Each worker uses signed command receipts to avoid duplicate processing. Set a unique `AGENTGIT_WORKER_ID` for each instance:

```env
AGENTGIT_WORKER_ID=worker-1
```

---

## Development

### Scripts

| Script | Description |
|---|---|
| `npm test` | Run all tests (Vitest). |
| `npm run test:watch` | Run tests in watch mode. |
| `npm run build` | Compile TypeScript to `dist/`. |
| `npm run typecheck` | Check types without emitting. |
| `npm run lint` | Run ESLint on `src/` and `tests/`. |
| `npm run dev` | Start the polling service with ts-node. |
| `npm run doctor` | Run health checks. |

### Test Suite

The project has **708 tests** across **39 test files**, covering:

- Command parsing (42 tests)
- Authorization and permissions (43 tests)
- State machine transitions (44 tests)
- Label management (15 tests)
- Metadata signing and verification (21 tests)
- Delegation (48 tests)
- Configuration loading and validation (42 tests)
- Task runner and resolver (45 tests)
- Safety rules and checker (71 tests)
- All 9 built-in skills (89 tests)
- OpenCode harness (31 tests)
- Polling integration (34 tests)
- Poller / stale recovery (12 tests)
- Setup CLI and doctor (21 tests)
- End-to-end smoke test (27 tests)
- GitHub API helpers (35 tests)

```bash
npm test

# Test Files  39 passed (39)
#      Tests  708 passed (708)
```

---

## Project Structure

```
agentgit/
  src/
    index.ts                      # Polling app entrypoint + event processors
    commands/
      parser.ts                   # /agent command parser
      handlers.ts                 # Command handler implementations
    config/
      defaults.ts                 # Default configuration values
      loader.ts                   # Config file loader (.agentGit/config.yml)
      schema.ts                   # Config validation
    github/
      auth.ts                     # Permission-based authorization
      branches.ts                 # Branch creation
      comments.ts                 # Plan/blocked/security comment builders
      delegation.ts               # Issue-scoped delegation management
      identity.ts                 # Bot identity verification
      pull-requests.ts            # PR creation and provenance verification
    harness/
      interface.ts                # CodingHarness interface
      opencode.ts                 # OpenCode implementation
      pi.ts                       # Pi implementation (stub)
    security/
      categories.ts               # Disallowed task categories
      checker.ts                  # TaskSafetyChecker skill
      rules.ts                    # Deterministic pattern rules (39 rules)
      signing.ts                  # HMAC-SHA256 signing/verification
    setup/
      cli.ts                      # CLI entrypoint (setup repo/server, doctor)
      doctor.ts                   # Health check runner
      labels.ts                   # Label provisioning
      permissions.ts              # GitHub App permission verification
      repo.ts                     # Repository setup
      server.ts                   # Server environment validation
    skills/
      interface.ts                # Skill/SkillResult/ExecutionContext types
      registry.ts                 # Skill registry with 9 built-in skills
      builtin/
        docs-checker.ts           # Documentation update checker
        issue-classifier.ts       # Issue type classification
        lint-runner.ts            # Lint/format checker
        plan-executor.ts          # Plan execution via harness
        plan-generator.ts         # Plan generation via harness
        pr-creator.ts             # PR preparation (commit, push, metadata)
        test-runner.ts            # Test suite runner (auto-detect or explicit)
        workspace-setup.ts        # Ephemeral workspace (clone, branch)
    state/
      labels.ts                   # 18 label definitions
      manager.ts                  # State manager (GitHub API label operations)
      reconciler.ts               # Polling controller + stale state recovery
      transitions.ts              # State machine (37 transitions)
    tasks/
      defaults/
        pre-plan.yml              # Safety review task
        plan.yml                  # Issue classification + plan generation
        build.yml                 # Workspace setup + plan execution
        post-build.yml            # Tests + docs + lint + PR creation
      loader.ts                   # Task definition loader
      resolver.ts                 # $-reference input resolver
      runner.ts                   # Sequential phase executor
    utils/
      env.ts                      # Environment variable loader
      logger.ts                   # Structured logger
      metadata.ts                 # HTML metadata comment parser/writer
    workspace/
      manager.ts                  # Ephemeral workspace creation/cleanup
  tests/                          # 39 test files, 708 tests
  .agentGit/                      # Self-referential config directory
    config.yml
    tasks/
    skills/
  .env.example                    # Environment variable template
  package.json
  tsconfig.json
  vitest.config.ts
```

---

## Build Status

All 15 build phases from the PLAN.md are complete:

| Phase | Description | Status |
|---|---|---|
| 0 | Project Scaffold | Done |
| 1 | Command Parser + Authorization | Done |
| 2 | Labels + State Machine | Done |
| 3 | Metadata Comments + Signing | Done |
| 4 | Delegation | Done |
| 5 | Config + Task Definition Loading | Done |
| 6 | Task Runner + Skill Registry | Done |
| 7 | Pre-Plan Safety Gate | Done |
| 8 | Planning Flow | Done |
| 9 | Workspace + Build Execution | Done |
| 10 | Post-Build Validation + PR Creation | Done |
| 11 | Polling Integration End-to-End | Done |
| 12 | Poller / Stale Recovery | Done |
| 13 | Setup CLI + Doctor | Done |
| 14 | Smoke Test | Done |

### Not Yet Implemented (v0.2+)

- Docker/firejail sandbox for execution environment
- Pi harness implementation
- PR self-review before notifying admin
- Cost tracking and per-issue budgets
- Distributed worker coordination with lease-based locking
- Distributed worker model (donated servers)
- Slack/Discord notifications
- Auto-retry on transient failures
- PR review feedback loop

---

## License

MIT
