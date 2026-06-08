export interface Command {
  /** Lowercase command name */
  action: string
  /** Remaining text after the command, trimmed */
  args: string
}

/**
 * All supported command actions.
 * Kept as a Set for O(1) lookup during parsing.
 */
const SUPPORTED_ACTIONS = new Set([
  "plan",
  "approve",
  "revise",
  "run",
  "stop",
  "retry",
  "delegate",
  "undelegate",
  "delegates",
  "status",
  "unlock-security",
  "close-unsafe",
  "security-status",
])

/**
 * Regex to match `/agent <action>` anywhere in a line.
 *
 * Breakdown:
 *   \/agent          - literal "/agent"
 *   \s+              - one or more whitespace chars between /agent and action
 *   ([\w-]+)         - capture group for the action (word chars + hyphens)
 *   (?:\s+(.*))?     - optional non-capturing group with capture for the rest of the line (args)
 *
 * The `i` flag makes matching case-insensitive.
 * The `m` flag makes ^ and $ match line boundaries (not used here, but we split by lines).
 */
const COMMAND_REGEX = /\/agent\s+([\w-]+)(?:\s+(.*))?/i

/**
 * Parse an `/agent` command from a comment body.
 *
 * The command can appear on any line of the body. The first valid match wins.
 * Actions are normalized to lowercase. Unknown actions return null.
 *
 * @param body - The full comment body text
 * @returns The parsed Command, or null if no valid command is found
 */
export function parseCommand(body: string): Command | null {
  if (!body || typeof body !== "string") {
    return null
  }

  const lines = body.split("\n")

  for (const line of lines) {
    const match = COMMAND_REGEX.exec(line)
    if (!match) {
      continue
    }

    const action = match[1].toLowerCase()

    if (!SUPPORTED_ACTIONS.has(action)) {
      continue
    }

    const args = (match[2] ?? "").trim()

    return { action, args }
  }

  return null
}
