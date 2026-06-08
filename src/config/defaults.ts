export interface AgentGitConfig {
  enabled: boolean
  ready_labels: string[]
  approval: {
    required_permissions: string[] // GitHubPermission values
    allowed_users: string[]
    delegation: {
      enabled: boolean
      min_delegator_permission: string
      min_delegate_permission: string
      allow_delegate_chaining: boolean
    }
  }
  security: {
    pre_plan_check: {
      enabled: boolean
      lock_on_unsafe: boolean
      admin_unlock_required: boolean
    }
    security_admins: string[]
    disallowed_categories: string[]
  }
  task_types: Record<string, { labels: string[] }>
  execution: {
    harness: string // "opencode" | "pi"
    model: string
    plan_model: string
    test_command: string // "auto" or explicit
    max_runtime_minutes: number
    branch_prefix: string
    auto_run_tests: boolean
    max_plan_revisions: number
  }
  execution_environment: {
    workspace_root: string
    cleanup_on_success: boolean
    cleanup_on_failure: boolean
  }
}

export const DEFAULT_CONFIG: AgentGitConfig = {
  enabled: true,

  ready_labels: ["agent:ready"],

  approval: {
    required_permissions: ["admin", "maintain"],
    allowed_users: [],
    delegation: {
      enabled: true,
      min_delegator_permission: "maintain",
      min_delegate_permission: "write",
      allow_delegate_chaining: false,
    },
  },

  security: {
    pre_plan_check: {
      enabled: true,
      lock_on_unsafe: true,
      admin_unlock_required: true,
    },
    security_admins: [],
    disallowed_categories: [
      "credential_theft",
      "malware",
      "data_exfiltration",
      "abuse",
      "policy_bypass",
      "destructive_change",
    ],
  },

  task_types: {
    bug: {
      labels: ["bug", "agent:type:bug"],
    },
    feature: {
      labels: ["enhancement", "agent:type:feature"],
    },
    docs: {
      labels: ["documentation", "agent:type:docs"],
    },
    ui: {
      labels: ["ui", "agent:type:ui"],
    },
  },

  execution: {
    harness: "opencode",
    model: "anthropic/claude-sonnet-4-20250514",
    plan_model: "anthropic/claude-sonnet-4-20250514",
    test_command: "auto",
    max_runtime_minutes: 60,
    branch_prefix: "agent/",
    auto_run_tests: true,
    max_plan_revisions: 5,
  },

  execution_environment: {
    workspace_root: "/tmp/agentgit",
    cleanup_on_success: true,
    cleanup_on_failure: false,
  },
}
