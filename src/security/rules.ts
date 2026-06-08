import { DisallowedCategory } from "./categories"

export interface RuleMatch {
  category: DisallowedCategory
  pattern: string
  matchedText: string
  confidence: number // 0-1
}

interface PatternRule {
  category: DisallowedCategory
  pattern: RegExp
  source: string // human-readable pattern description
  confidence: number
}

const RULES: PatternRule[] = [
  // ── credential_theft ──────────────────────────────────────────────
  {
    category: "credential_theft",
    pattern: /print\s+(all\s+)?env(ironment)?\s*(var(iable)?s?)?/i,
    source: "print env vars",
    confidence: 0.9,
  },
  {
    category: "credential_theft",
    pattern: /echo\s+\$/i,
    source: "echo $ (env variable expansion)",
    confidence: 0.8,
  },
  {
    category: "credential_theft",
    pattern: /\.env\s+(file|contents?)/i,
    source: ".env file reference",
    confidence: 0.8,
  },
  {
    category: "credential_theft",
    pattern: /send\s+\.env/i,
    source: "send .env",
    confidence: 0.95,
  },
  {
    category: "credential_theft",
    pattern: /environment\s+variable/i,
    source: "environment variable mention",
    confidence: 0.5,
  },
  {
    category: "credential_theft",
    pattern: /api[_\s-]?key/i,
    source: "API key reference",
    confidence: 0.5,
  },
  {
    category: "credential_theft",
    pattern: /process\.env/i,
    source: "process.env access",
    confidence: 0.6,
  },
  {
    category: "credential_theft",
    pattern: /dump\s+(all\s+)?(cred(ential)?s?|secrets?|tokens?)/i,
    source: "dump credentials/secrets/tokens",
    confidence: 0.9,
  },

  // ── malware ───────────────────────────────────────────────────────
  {
    category: "malware",
    pattern: /reverse\s+shell/i,
    source: "reverse shell",
    confidence: 0.95,
  },
  {
    category: "malware",
    pattern: /back\s*door/i,
    source: "backdoor",
    confidence: 0.9,
  },
  {
    category: "malware",
    pattern: /startup\s+script/i,
    source: "startup script",
    confidence: 0.7,
  },
  {
    category: "malware",
    pattern: /cron\s*job/i,
    source: "cron job",
    confidence: 0.6,
  },
  {
    category: "malware",
    pattern: /persistence\s+(mechanism|script|payload)/i,
    source: "persistence mechanism",
    confidence: 0.9,
  },
  {
    category: "malware",
    pattern: /key\s*logger/i,
    source: "keylogger",
    confidence: 0.95,
  },
  {
    category: "malware",
    pattern: /rootkit/i,
    source: "rootkit",
    confidence: 0.95,
  },

  // ── data_exfiltration ─────────────────────────────────────────────
  {
    category: "data_exfiltration",
    pattern: /upload\s+to\s+external/i,
    source: "upload to external",
    confidence: 0.9,
  },
  {
    category: "data_exfiltration",
    pattern: /send\s+to\s+(url|endpoint|server)/i,
    source: "send to URL/endpoint/server",
    confidence: 0.8,
  },
  {
    category: "data_exfiltration",
    pattern: /exfiltrat/i,
    source: "exfiltrate/exfiltration",
    confidence: 0.95,
  },
  {
    category: "data_exfiltration",
    pattern: /http\s*post.*secret/i,
    source: "HTTP POST secret",
    confidence: 0.9,
  },
  {
    category: "data_exfiltration",
    pattern: /curl.*secret/i,
    source: "curl secret",
    confidence: 0.85,
  },
  {
    category: "data_exfiltration",
    pattern: /send\s+(repo|repository|codebase|source)\s+(contents?|code|files?)/i,
    source: "send repo contents",
    confidence: 0.9,
  },

  // ── abuse ─────────────────────────────────────────────────────────
  {
    category: "abuse",
    pattern: /spam/i,
    source: "spam",
    confidence: 0.7,
  },
  {
    category: "abuse",
    pattern: /open\s+\d{3,}\s+(issue|pr|pull\s+request)/i,
    source: "open many issues/PRs",
    confidence: 0.9,
  },
  {
    category: "abuse",
    pattern: /mass\s+create/i,
    source: "mass create",
    confidence: 0.85,
  },
  {
    category: "abuse",
    pattern: /flood/i,
    source: "flood",
    confidence: 0.7,
  },
  {
    category: "abuse",
    pattern: /d{2}os/i,
    source: "DDoS",
    confidence: 0.9,
  },

  // ── policy_bypass ─────────────────────────────────────────────────
  {
    category: "policy_bypass",
    pattern: /disable\s+branch\s+protection/i,
    source: "disable branch protection",
    confidence: 0.95,
  },
  {
    category: "policy_bypass",
    pattern: /skip\s+ci/i,
    source: "skip CI",
    confidence: 0.8,
  },
  {
    category: "policy_bypass",
    pattern: /remove\s+codeowners/i,
    source: "remove CODEOWNERS",
    confidence: 0.9,
  },
  {
    category: "policy_bypass",
    pattern: /bypass\s+review/i,
    source: "bypass review",
    confidence: 0.9,
  },
  {
    category: "policy_bypass",
    pattern: /force\s+push\s+to\s+main/i,
    source: "force push to main",
    confidence: 0.9,
  },
  {
    category: "policy_bypass",
    pattern: /disable\s+(security|protection|check)/i,
    source: "disable security/protection/check",
    confidence: 0.8,
  },

  // ── destructive_change ────────────────────────────────────────────
  {
    category: "destructive_change",
    pattern: /delete\s+all/i,
    source: "delete all",
    confidence: 0.9,
  },
  {
    category: "destructive_change",
    pattern: /rm\s+-rf/i,
    source: "rm -rf",
    confidence: 0.9,
  },
  {
    category: "destructive_change",
    pattern: /drop\s+(database|table|collection)/i,
    source: "drop database/table/collection",
    confidence: 0.9,
  },
  {
    category: "destructive_change",
    pattern: /force[\s-]+push\s+to\s+main/i,
    source: "force-push to main",
    confidence: 0.9,
  },
  {
    category: "destructive_change",
    pattern: /truncate\s+table/i,
    source: "truncate table",
    confidence: 0.9,
  },
  {
    category: "destructive_change",
    pattern: /format\s+disk/i,
    source: "format disk",
    confidence: 0.9,
  },
  {
    category: "destructive_change",
    pattern: /delete\s+(the\s+)?(entire\s+)?(repo(sitory)?|codebase|project)/i,
    source: "delete repository/codebase",
    confidence: 0.95,
  },
]

/**
 * Check text against all deterministic rules for the specified disallowed categories.
 * Returns all matches found, sorted by confidence descending.
 */
export function checkRules(
  text: string,
  categories: DisallowedCategory[],
): RuleMatch[] {
  const categorySet = new Set(categories)
  const matches: RuleMatch[] = []

  for (const rule of RULES) {
    if (!categorySet.has(rule.category)) {
      continue
    }

    const match = rule.pattern.exec(text)
    if (match) {
      matches.push({
        category: rule.category,
        pattern: rule.source,
        matchedText: match[0],
        confidence: rule.confidence,
      })
    }
  }

  matches.sort((a, b) => b.confidence - a.confidence)
  return matches
}
