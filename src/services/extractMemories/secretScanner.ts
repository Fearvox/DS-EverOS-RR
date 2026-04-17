/**
 * Secret scanner for memory extraction.
 *
 * Scans content destined for auto-memory files and rejects writes that
 * contain API keys, credentials, or other secrets. The memory extraction
 * agent (a forked sub-agent) writes .md files — without this gate it
 * could inadvertently persist secrets from the conversation to disk.
 *
 * Regexes are compiled once at module load to avoid per-call overhead.
 */

// ============================================================================
// Types
// ============================================================================

export interface SecretFinding {
  /** Name of the pattern that matched (e.g., "AWS Access Key") */
  pattern: string
  /** The matched substring (first 8 chars + "..." for safety) */
  match: string
  /** 1-based line number where the match was found */
  line: number
}

// ============================================================================
// Placeholder exclusion
// ============================================================================

/**
 * Returns true when the value portion of a generic assignment looks like a
 * placeholder rather than a real secret. Common in documentation and
 * template files.
 */
const PLACEHOLDER_RE =
  /^[<\[{].*[>\]}]$|^x{3,}$|^\*{3,}$|^\.{3,}$|^your[-_]|^<your[-_]|^placeholder$|^changeme$|^TODO$|^CHANGEME$/i

function isPlaceholderValue(value: string): boolean {
  return PLACEHOLDER_RE.test(value.trim())
}

// ============================================================================
// Pattern definitions
// ============================================================================

interface SecretPattern {
  name: string
  regex: RegExp
  /** Optional post-match filter. Return true to EXCLUDE the match (false positive). */
  exclude?: (fullMatch: string) => boolean
}

const SECRET_PATTERNS: SecretPattern[] = [
  {
    name: 'AWS Access Key',
    regex: /AKIA[0-9A-Z]{16}/g,
  },
  {
    name: 'AWS Secret Key',
    regex:
      /(?:aws_secret_access_key|AWS_SECRET_ACCESS_KEY)\s*[=:]\s*(\S{20,})/g,
    exclude: (_fullMatch: string) => {
      // Extract the value after = or :
      const m = /[=:]\s*(\S+)/.exec(_fullMatch)
      return m ? isPlaceholderValue(m[1]) : false
    },
  },
  {
    name: 'GitHub Token',
    regex: /gh[ps]_[A-Za-z0-9_]{36,}/g,
  },
  {
    name: 'GitHub OAuth',
    regex: /gho_[A-Za-z0-9_]{36,}/g,
  },
  {
    name: 'Anthropic API Key',
    regex: /sk-ant-[a-zA-Z0-9]{2,}-[A-Za-z0-9_-]{20,}/g,
  },
  {
    name: 'Generic API Key',
    regex:
      /(?:sk-|pk_live_|pk_test_|sk_live_|sk_test_|rk_live_|rk_test_)[A-Za-z0-9]{20,}/g,
  },
  {
    name: 'Slack Token',
    regex: /xox[bpors]-[A-Za-z0-9-]{10,}/g,
  },
  {
    name: 'SSH Private Key',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
  },
  {
    name: 'JWT Token',
    regex:
      /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g,
  },
  {
    name: 'Database URL',
    regex: /(?:postgres|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s]{10,}/g,
  },
  {
    name: 'Generic Secret Assignment',
    regex:
      /(?:SECRET|PASSWORD|TOKEN|CREDENTIAL|API_KEY|PRIVATE_KEY)\s*[=:]\s*['"]?([A-Za-z0-9/+_-]{8,})/gi,
    exclude: (fullMatch: string) => {
      // Extract the value portion after the = or :
      const m = /[=:]\s*['"]?([A-Za-z0-9/+_-]+)/.exec(fullMatch)
      if (!m) return false
      const value = m[1]
      return isPlaceholderValue(value) || /^\*+$/.test(value)
    },
  },
]

// ============================================================================
// Public API
// ============================================================================

/**
 * Scans content for secret patterns that must not be persisted to memory files.
 * Returns an array of findings (empty = clean).
 */
export function scanForSecrets(content: string): SecretFinding[] {
  const findings: SecretFinding[] = []
  const lines = content.split('\n')

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]

    for (const pattern of SECRET_PATTERNS) {
      // Reset lastIndex for global regexes before each line
      pattern.regex.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = pattern.regex.exec(line)) !== null) {
        const fullMatch = m[0]

        // Apply per-pattern exclusion filter (false positive suppression)
        if (pattern.exclude?.(fullMatch)) {
          continue
        }

        findings.push({
          pattern: pattern.name,
          match: truncateMatch(fullMatch),
          line: lineIdx + 1, // 1-based
        })
      }
    }
  }

  return findings
}

/**
 * Returns true if content contains any secret patterns.
 * Convenience wrapper around scanForSecrets.
 */
export function containsSecrets(content: string): boolean {
  return scanForSecrets(content).length > 0
}

// ============================================================================
// Internals
// ============================================================================

/** Truncate a matched string to first 8 chars + "..." to avoid logging full secrets. */
function truncateMatch(match: string): string {
  if (match.length <= 8) {
    return match
  }
  return match.slice(0, 8) + '...'
}
