import { existsSync, readFileSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { getAllFlags } from '../../utils/featureFlag.js'

export type FlagStatus = 'operational' | 'loadable' | 'broken' | 'missing-dep'

export interface FlagHealthResult {
  flag: string
  status: FlagStatus
  loadTimeMs: number
  error?: string
  dependsOn?: string[]
}

// Mapping of flag names to potential module paths
// Convention: FLAG_NAME → src/services/flagName/ or src/tools/flagName/
const FLAG_MODULE_PATTERNS: Record<string, string[]> = {
  EXTRACT_MEMORIES: ['src/services/extractMemories/extractMemories.ts'],
  CONTEXT_COLLAPSE: ['src/services/contextCollapse/index.ts'],
  AGENT_MEMORY_SNAPSHOT: ['src/services/AgentSummary/'],
  MCP_SKILLS: ['src/services/skillSearch/'],
  MCP_RICH_OUTPUT: ['src/services/mcp/'],
  TREE_SITTER_BASH: ['src/utils/permissions/'],
  ULTRATHINK: ['src/services/compact/compact.ts'],
  ULTRAPLAN: ['src/services/compact/compact.ts'],
  REACTIVE_COMPACT: ['src/services/compact/reactiveCompact.ts'],
  HISTORY_SNIP: ['src/services/compact/snipCompact.ts'],
  TOKEN_BUDGET: ['src/services/compact/'],
  COMPACTION_REMINDERS: ['src/services/compact/compact.ts'],
  FILE_PERSISTENCE: ['src/services/sessionTranscript/'],
  SKILL_IMPROVEMENT: ['src/services/skillSearch/'],
  REVIEW_ARTIFACT: ['src/services/AgentSummary/'],
  SHOT_STATS: ['src/services/analytics/'],
  SLOW_OPERATION_LOGGING: ['src/services/internalLogging.ts'],
  BREAK_CACHE_COMMAND: ['src/services/AgentSummary/'],
  AUTO_THEME: ['src/components/Settings/Settings.tsx'],
  HISTORY_PICKER: ['src/services/compact/'],
  HOOK_PROMPTS: ['src/services/sessionTranscript/'],
  DYNAMIC_PERMISSION_ESCALATION: ['src/utils/permissions/permissionSetup.ts'],
  MESSAGE_ACTIONS: ['src/components/Messages.tsx'],
  QUICK_SEARCH: ['src/services/skillSearch/'],
  NEW_INIT: ['src/entrypoints/init.ts'],
  STREAMLINED_OUTPUT: ['src/services/compact/'],
  TERMINAL_PANEL: ['src/components/'],
  VERIFICATION_AGENT: ['src/services/tools/'],
  WEB_BROWSER_TOOL: ['src/services/tools/'],
  BUILTIN_EXPLORE_PLAN_AGENTS: ['src/services/tools/'],
  COMMIT_ATTRIBUTION: ['src/services/'],
  COORDINATOR_MODE: ['src/services/'],
  EXPERIMENTAL_SKILL_SEARCH: ['src/services/skillSearch/'],
  FORK_SUBAGENT: ['src/services/'],
  MCP_SERVER_APPROVAL: ['src/services/mcp/mcpServerApproval.tsx'],
  REMOTE_MANAGED_SETTINGS: ['src/services/remoteManagedSettings/'],
  TEAM_MEMORY_SYNC: ['src/services/teamMemorySync/'],
  AWAY_SUMMARY: ['src/services/awaySummary.ts'],
  SETTINGS_SYNC: ['src/services/settingsSync/'],
  PROMPT_SUGGESTION: ['src/services/PromptSuggestion/'],
  VCR: ['src/services/vcr.ts'],
  VOICE: ['src/services/voice.ts'],
  VOICE_KEYTERMS: ['src/services/voiceKeyterms.ts'],
  VOICE_STREAM_STT: ['src/services/voiceStreamSTT.ts'],
  PREVENT_SLEEP: ['src/services/preventSleep.ts'],
  NOTIFIER: ['src/services/notifier.ts'],
  MAGIC_DOCS: ['src/services/MagicDocs/'],
  LSP: ['src/services/lsp/'],
  RATE_LIMIT_MESSAGES: ['src/services/rateLimitMessages.ts'],
  RATE_LIMIT_MOCKING: ['src/services/rateLimitMocking.ts'],
  DIAGNOSTIC_TRACKING: ['src/services/diagnosticTracking.ts'],
  TOKEN_ESTIMATION: ['src/services/tokenEstimation.ts'],
  CLAUDE_AI_LIMITS: ['src/services/claudeAiLimits.ts'],
}

// Dependency relationships between flags
const FLAG_DEPENDENCIES: Record<string, string[]> = {
  EXTRACT_MEMORIES: ['CONTEXT_COLLAPSE', 'TOKEN_BUDGET'],
  AGENT_MEMORY_SNAPSHOT: ['EXTRACT_MEMORIES', 'CONTEXT_COLLAPSE'],
  REACTIVE_COMPACT: ['TOKEN_BUDGET', 'COMPACTION_REMINDERS'],
  ULTRATHINK: ['TOKEN_BUDGET'],
  ULTRAPLAN: ['TOKEN_BUDGET', 'BUILTIN_EXPLORE_PLAN_AGENTS'],
  CONTEXT_COLLAPSE: ['TOKEN_BUDGET'],
  FORK_SUBAGENT: ['AGENT_MEMORY_SNAPSHOT'],
  SKILL_IMPROVEMENT: ['MCP_SKILLS', 'EXPERIMENTAL_SKILL_SEARCH'],
  REVIEW_ARTIFACT: ['EXTRACT_MEMORIES'],
  COMPACTION_REMINDERS: ['TOKEN_BUDGET'],
  // Special flags with unusual naming - likely test/debug flags
  tengu_passport_quail: [],
  ABLATION_BASELINE: [],
  BUILDING_CLAUDE_APPS: [],
  BRIDGE_MODE: [],
  CACHED_MICROCOMPACT: [],
  DYNAMIC_PERMISSION_ESCALATION: [],
}

// Get the base path for the project
function getProjectRoot(): string {
  // Assuming this file is at src/services/flagHealth/flagHealth.ts
  // Project root is 3 levels up
  return join(dirname(new URL(import.meta.url).pathname), '..', '..', '..')
}

/**
 * Resolve a module path - if path is a directory, look for index.ts inside
 */
function resolveModulePath(basePath: string): string | null {
  if (!existsSync(basePath)) {
    return null
  }

  try {
    const stat = statSync(basePath)
    if (stat.isFile()) {
      return basePath
    }
    if (stat.isDirectory()) {
      // Look for index.ts in directory
      const indexPath = join(basePath, 'index.ts')
      if (existsSync(indexPath)) {
        return indexPath
      }
      // No index.ts found - directory exists but no entry point
      return basePath // Return the directory path - we'll handle this specially
    }
  } catch {
    return null
  }
  return null
}

/**
 * Attempt to determine if a flag's gated module can be loaded.
 * Returns the status based on module existence and loadability.
 */
function checkModuleStatus(flag: string, projectRoot: string): {
  status: FlagStatus
  loadTimeMs: number
  error?: string
} {
  const startTime = Date.now()
  const patterns = FLAG_MODULE_PATTERNS[flag] || []

  // If no known patterns, assume loadable (flag exists but module path unknown)
  if (patterns.length === 0) {
    return {
      status: 'loadable',
      loadTimeMs: Date.now() - startTime,
    }
  }

  for (const pattern of patterns) {
    const fullPath = join(projectRoot, pattern)
    const resolvedPath = resolveModulePath(fullPath)

    if (!resolvedPath) {
      continue
    }

    // Check if resolved path is a directory (no index.ts found)
    try {
      const stat = statSync(resolvedPath)
      if (stat.isDirectory()) {
        // Directory exists but no index.ts - this is a broken module reference
        return {
          status: 'broken',
          loadTimeMs: Date.now() - startTime,
          error: 'Module directory has no entry point (index.ts)',
        }
      }
    } catch {
      // stat failed, continue
    }

    // Module path exists and appears to be a file, try to read it
    try {
      const content = readFileSync(resolvedPath, 'utf-8')

      // Basic syntax validation - check for common error patterns
      if (content.includes('<<<UNKNOWN>>>') || content.includes('{}')) {
        return {
          status: 'broken',
          loadTimeMs: Date.now() - startTime,
          error: 'Module contains decompilation artifacts',
        }
      }

      return {
        status: 'operational',
        loadTimeMs: Date.now() - startTime,
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)

      if (error.includes('ENOENT')) {
        continue
      }

      if (error.includes('EISDIR')) {
        return {
          status: 'broken',
          loadTimeMs: Date.now() - startTime,
          error: 'Path is a directory, not a file',
        }
      }

      if (error.includes('dependency') || error.includes('peer')) {
        return {
          status: 'missing-dep',
          loadTimeMs: Date.now() - startTime,
          error,
        }
      }

      return {
        status: 'broken',
        loadTimeMs: Date.now() - startTime,
        error,
      }
    }
  }

  // No matching module found
  return {
    status: 'loadable',
    loadTimeMs: Date.now() - startTime,
  }
}

/**
 * Scan all active feature flags and generate health results.
 * @returns Array of FlagHealthResult sorted alphabetically by flag name
 */
export async function scanAllFlags(): Promise<FlagHealthResult[]> {
  const flags = getAllFlags()
  const activeFlags = Object.entries(flags)
    .filter(([, enabled]) => enabled === true)
    .map(([name]) => name)

  const projectRoot = getProjectRoot()
  const results: FlagHealthResult[] = []

  for (const flag of activeFlags) {
    const { status, loadTimeMs, error } = checkModuleStatus(flag, projectRoot)
    const dependsOn = FLAG_DEPENDENCIES[flag] || []

    results.push({
      flag,
      status,
      loadTimeMs,
      error,
      dependsOn: dependsOn.length > 0 ? dependsOn : undefined,
    })
  }

  // Sort alphabetically by flag name
  results.sort((a, b) => a.flag.localeCompare(b.flag))

  return results
}
