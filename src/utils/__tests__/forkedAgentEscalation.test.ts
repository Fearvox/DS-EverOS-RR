/**
 * Tests for forked agent escalation isolation (PERM-06).
 *
 * Validates that:
 * - stripEscalationRules removes ONLY 'escalation' key from alwaysAllowRules
 * - 'session' key (allowedTools, .claude session-only rules) is preserved (review HIGH #2)
 * - All other rule sources are preserved
 * - Deny and ask rules are never touched
 * - createSubagentContext applies stripping inside getAppState wrapper
 * - Feature flag gates all behavior
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import type { ToolPermissionContext } from 'src/types/permissions.js'

// Mock feature flag BEFORE importing the module under test
const featureMock = mock(() => true)
mock.module('src/utils/featureFlag.js', () => ({
  feature: (name: string) => {
    if (name === 'DYNAMIC_PERMISSION_ESCALATION') return featureMock()
    return false
  },
  _reloadFlagsForTesting: () => {},
}))

// Import AFTER mock setup
import { stripEscalationRules, createSubagentContext } from '../forkedAgent.js'
import type { ToolUseContext } from 'src/Tool.js'
import { getEmptyToolPermissionContext } from 'src/Tool.js'
import type { AppState } from 'src/state/AppState.js'
import { createFileStateCacheWithSizeLimit } from 'src/utils/fileStateCache.js'

afterAll(() => {
  mock.restore()
})

// ============================================================================
// Test Data
// ============================================================================

/**
 * Permission context with BOTH session AND escalation rules.
 * Carefully chosen to test review HIGH #2:
 * - session rules (allowedTools, .claude rules) MUST survive stripping
 * - escalation rules MUST be stripped
 */
function createMockPermissionContext(): ToolPermissionContext {
  return {
    mode: 'default' as const,
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {
      cliArg: ['Bash(bun test:*)'],
      session: ['Bash(npm run dev:*)', 'FileEdit(/tmp/**)'],
      escalation: ['Bash(npm publish:*)', 'FileEdit(/deploy/**)'],
      userSettings: ['Read(**)'],
    },
    alwaysDenyRules: {
      session: ['Bash(rm -rf /:*)'],
      escalation: [],
    },
    alwaysAskRules: {
      userSettings: ['Bash(sudo:*)'],
    },
    isBypassPermissionsModeAvailable: false,
  }
}

function createMockToolUseContext(
  permissionContext: ToolPermissionContext,
  overrides?: Partial<ToolUseContext>,
): ToolUseContext {
  const appState = {
    toolPermissionContext: permissionContext,
  } as AppState

  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'claude-sonnet-4-5-20250514',
      tools: [],
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      isNonInteractiveSession: true,
      agentDefinitions: {
        activeAgents: [],
        allowedAgentTypes: undefined,
      },
    },
    abortController: new AbortController(),
    readFileState: createFileStateCacheWithSizeLimit(100),
    getAppState: () => appState,
    setAppState: () => {},
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    messages: [],
    ...overrides,
  } as ToolUseContext
}

// ============================================================================
// stripEscalationRules Tests
// ============================================================================

describe('stripEscalationRules', () => {
  it('removes escalation key from alwaysAllowRules', () => {
    const ctx = createMockPermissionContext()
    const stripped = stripEscalationRules(ctx)
    expect(stripped.alwaysAllowRules.escalation).toBeUndefined()
  })

  it('preserves session key in alwaysAllowRules (review HIGH #2)', () => {
    const ctx = createMockPermissionContext()
    const stripped = stripEscalationRules(ctx)
    expect(stripped.alwaysAllowRules.session).toEqual([
      'Bash(npm run dev:*)',
      'FileEdit(/tmp/**)',
    ])
  })

  it('preserves cliArg key in alwaysAllowRules', () => {
    const ctx = createMockPermissionContext()
    const stripped = stripEscalationRules(ctx)
    expect(stripped.alwaysAllowRules.cliArg).toEqual(['Bash(bun test:*)'])
  })

  it('preserves userSettings key in alwaysAllowRules', () => {
    const ctx = createMockPermissionContext()
    const stripped = stripEscalationRules(ctx)
    expect(stripped.alwaysAllowRules.userSettings).toEqual(['Read(**)'])
  })

  it('preserves alwaysDenyRules completely (all sources)', () => {
    const ctx = createMockPermissionContext()
    const stripped = stripEscalationRules(ctx)
    expect(stripped.alwaysDenyRules).toEqual(ctx.alwaysDenyRules)
  })

  it('preserves alwaysAskRules completely (all sources)', () => {
    const ctx = createMockPermissionContext()
    const stripped = stripEscalationRules(ctx)
    expect(stripped.alwaysAskRules).toEqual(ctx.alwaysAskRules)
  })

  it('returns context unchanged when no escalation rules exist', () => {
    const ctx: ToolPermissionContext = {
      mode: 'default' as const,
      additionalWorkingDirectories: new Map(),
      alwaysAllowRules: {
        session: ['Bash(npm run dev:*)'],
        cliArg: ['Read(**)'],
      },
      alwaysDenyRules: {},
      alwaysAskRules: {},
      isBypassPermissionsModeAvailable: false,
    }
    const stripped = stripEscalationRules(ctx)
    expect(stripped.alwaysAllowRules.session).toEqual(['Bash(npm run dev:*)'])
    expect(stripped.alwaysAllowRules.cliArg).toEqual(['Read(**)'])
    expect(stripped.alwaysAllowRules.escalation).toBeUndefined()
  })

  it('preserves all other ToolPermissionContext fields', () => {
    const ctx = createMockPermissionContext()
    const stripped = stripEscalationRules(ctx)
    expect(stripped.mode).toBe('default')
    expect(stripped.isBypassPermissionsModeAvailable).toBe(false)
    expect(stripped.additionalWorkingDirectories).toBe(
      ctx.additionalWorkingDirectories,
    )
  })
})

// ============================================================================
// createSubagentContext escalation isolation Tests
// ============================================================================

describe('createSubagentContext escalation isolation', () => {
  beforeEach(() => {
    featureMock.mockImplementation(() => true)
  })

  it('forked context getAppState returns toolPermissionContext without escalation allow rules', () => {
    const permCtx = createMockPermissionContext()
    const parentCtx = createMockToolUseContext(permCtx)
    const forked = createSubagentContext(parentCtx)

    const forkedState = forked.getAppState()
    expect(
      forkedState.toolPermissionContext.alwaysAllowRules.escalation,
    ).toBeUndefined()
  })

  it('parent context getAppState still has escalation rules (not mutated)', () => {
    const permCtx = createMockPermissionContext()
    const parentCtx = createMockToolUseContext(permCtx)
    createSubagentContext(parentCtx)

    const parentState = parentCtx.getAppState()
    expect(
      parentState.toolPermissionContext.alwaysAllowRules.escalation,
    ).toEqual(['Bash(npm publish:*)', 'FileEdit(/deploy/**)'])
  })

  it('session allow rules are PRESERVED in forked context (review HIGH #2)', () => {
    const permCtx = createMockPermissionContext()
    const parentCtx = createMockToolUseContext(permCtx)
    const forked = createSubagentContext(parentCtx)

    const forkedState = forked.getAppState()
    expect(
      forkedState.toolPermissionContext.alwaysAllowRules.session,
    ).toEqual(['Bash(npm run dev:*)', 'FileEdit(/tmp/**)'])
  })

  it('when feature flag disabled, escalation rules are preserved', () => {
    featureMock.mockImplementation(() => false)

    const permCtx = createMockPermissionContext()
    const parentCtx = createMockToolUseContext(permCtx)
    const forked = createSubagentContext(parentCtx)

    const forkedState = forked.getAppState()
    // With flag off, escalation rules should NOT be stripped
    expect(
      forkedState.toolPermissionContext.alwaysAllowRules.escalation,
    ).toEqual(['Bash(npm publish:*)', 'FileEdit(/deploy/**)'])
  })

  it('when overrides.getAppState provided, no stripping applied', () => {
    const permCtx = createMockPermissionContext()
    const parentCtx = createMockToolUseContext(permCtx)
    const customGetAppState = () => parentCtx.getAppState()

    const forked = createSubagentContext(parentCtx, {
      getAppState: customGetAppState,
    })

    const forkedState = forked.getAppState()
    // Custom getAppState returns parent state unchanged
    expect(
      forkedState.toolPermissionContext.alwaysAllowRules.escalation,
    ).toEqual(['Bash(npm publish:*)', 'FileEdit(/deploy/**)'])
  })

  it('shareAbortController branch also strips escalation rules', () => {
    const permCtx = createMockPermissionContext()
    const parentCtx = createMockToolUseContext(permCtx)
    const forked = createSubagentContext(parentCtx, {
      shareAbortController: true,
    })

    const forkedState = forked.getAppState()
    expect(
      forkedState.toolPermissionContext.alwaysAllowRules.escalation,
    ).toBeUndefined()
    // session preserved
    expect(
      forkedState.toolPermissionContext.alwaysAllowRules.session,
    ).toEqual(['Bash(npm run dev:*)', 'FileEdit(/tmp/**)'])
  })
})
