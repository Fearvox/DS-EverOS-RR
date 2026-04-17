/**
 * Tests for escalation integration in hasPermissionsToUseTool (PERM-04).
 *
 * Validates that:
 * - Step 2c escalation check inside hasPermissionsToUseToolInner returns allow when grant exists
 * - Feature flag gates all escalation behavior
 * - Deny rules (step 1a) take precedence over escalation (step 2c)
 * - contextId isolation: forked agents with different agentIds don't see parent grants
 * - ruleContent granularity: tool+content matching works correctly
 * - PERM-05: no persistence -- revokeAllEscalations clears grants immediately
 *
 * Review HIGH #3: By placing escalation inside hasPermissionsToUseToolInner,
 * ALL callers (toolExecution.ts, interactiveHandler.recheckPermission, headless)
 * see it consistently.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import type { PermissionResult } from 'src/types/permissions.js'
import type { Tool } from 'src/Tool.js'
import { getEmptyToolPermissionContext } from 'src/Tool.js'
import type { AppState } from 'src/state/AppState.js'

// Mock feature flag BEFORE importing the module under test
const featureMock = mock(() => true)
mock.module('src/utils/featureFlag.js', () => ({
  feature: (name: string) => {
    if (name === 'DYNAMIC_PERMISSION_ESCALATION') return featureMock()
    return false
  },
  _reloadFlagsForTesting: () => {},
}))

import { hasPermissionsToUseTool } from '../permissions.js'
import { createTestToolUseContext } from 'src/tools/__tests__/createTestToolUseContext.js'
import {
  _resetForTesting,
  registerMainSessionContext,
  grantEscalation,
  revokeAllEscalations,
} from '../escalation/EscalationStore.js'

afterAll(() => {
  mock.restore()
})

// ============================================================================
// Constants
// ============================================================================

const MAIN_SESSION_ID = 'test-main-session'
const FORKED_AGENT_ID = 'forked-agent-xyz'

// ============================================================================
// Mock parent assistant message (required by hasPermissionsToUseTool)
// ============================================================================
const mockParentMessage = {
  type: 'assistant' as const,
  content: [{ type: 'tool_use', id: 'test-id', name: 'Bash', input: {} }],
  message: { role: 'assistant' as const, content: [] },
  costUSD: 0,
  durationMs: 0,
  uuid: 'test-uuid',
}

// ============================================================================
// Mock Tool factory
// ============================================================================
function createMockTool(
  name = 'Bash',
  checkPermissionsResult: PermissionResult = {
    behavior: 'passthrough',
    message: 'no permission check',
  },
): Tool {
  return {
    name,
    inputSchema: { parse: (x: unknown) => x } as unknown as Tool['inputSchema'],
    checkPermissions: async () => checkPermissionsResult,
    isConcurrencySafe: () => true,
    isEnabled: () => true,
    isReadOnly: () => true,
    maxResultSizeChars: 100_000,
    call: async () => ({ type: 'result', data: null }),
    description: async () => `${name} description`,
    prompt: async () => `${name} prompt`,
    userFacingName: () => name,
  } as unknown as Tool
}

// ============================================================================
// Tests
// ============================================================================

describe('escalation integration in hasPermissionsToUseTool', () => {
  beforeEach(() => {
    _resetForTesting()
    featureMock.mockImplementation(() => true)
    registerMainSessionContext(MAIN_SESSION_ID)
  })

  // --------------------------------------------------------------------------
  // Step 2c: escalation check
  // --------------------------------------------------------------------------
  describe('step 2c: escalation check', () => {
    it('returns allow when escalation is granted for contextId + tool', async () => {
      grantEscalation({
        contextId: MAIN_SESSION_ID,
        toolName: 'Bash',
        grantedAt: Date.now(),
        reason: 'test escalation',
      })

      const tool = createMockTool('Bash')
      const ctx = createTestToolUseContext({
        agentId: MAIN_SESSION_ID as any,
      })

      const result = await hasPermissionsToUseTool(
        tool,
        { command: 'npm publish' },
        ctx,
        mockParentMessage as any,
        'tu-esc-01',
      )

      expect(result.behavior).toBe('allow')
    })

    it('returns ask/passthrough when no escalation exists', async () => {
      // No grant registered
      const tool = createMockTool('Bash')
      const ctx = createTestToolUseContext({
        agentId: MAIN_SESSION_ID as any,
      })

      const result = await hasPermissionsToUseTool(
        tool,
        { command: 'npm publish' },
        ctx,
        mockParentMessage as any,
        'tu-esc-02',
      )

      // passthrough converts to ask in step 3
      expect(result.behavior).toBe('ask')
    })

    it('returns allow with correct decisionReason when escalation matches', async () => {
      grantEscalation({
        contextId: MAIN_SESSION_ID,
        toolName: 'Bash',
        grantedAt: Date.now(),
        reason: 'test escalation',
      })

      const tool = createMockTool('Bash')
      const ctx = createTestToolUseContext({
        agentId: MAIN_SESSION_ID as any,
      })

      const result = await hasPermissionsToUseTool(
        tool,
        { command: 'npm test' },
        ctx,
        mockParentMessage as any,
        'tu-esc-03',
      )

      expect(result.behavior).toBe('allow')
      expect(result.decisionReason).toBeDefined()
      expect(result.decisionReason!.type).toBe('rule')
      if (result.decisionReason!.type === 'rule') {
        expect(result.decisionReason!.rule.source).toBe('escalation')
        expect(result.decisionReason!.rule.ruleBehavior).toBe('allow')
      }
    })
  })

  // --------------------------------------------------------------------------
  // Feature flag gating
  // --------------------------------------------------------------------------
  describe('feature flag gating', () => {
    it('when DYNAMIC_PERMISSION_ESCALATION disabled, escalation check is skipped', async () => {
      featureMock.mockImplementation(() => false)

      grantEscalation({
        contextId: MAIN_SESSION_ID,
        toolName: 'Bash',
        grantedAt: Date.now(),
        reason: 'test escalation',
      })

      const tool = createMockTool('Bash')
      const ctx = createTestToolUseContext({
        agentId: MAIN_SESSION_ID as any,
      })

      const result = await hasPermissionsToUseTool(
        tool,
        { command: 'npm test' },
        ctx,
        mockParentMessage as any,
        'tu-esc-04',
      )

      // Without the flag, escalation is not checked -- passthrough becomes ask
      expect(result.behavior).toBe('ask')
    })

    it('when enabled, escalation check runs and returns allow', async () => {
      featureMock.mockImplementation(() => true)

      grantEscalation({
        contextId: MAIN_SESSION_ID,
        toolName: 'Bash',
        grantedAt: Date.now(),
        reason: 'test escalation',
      })

      const tool = createMockTool('Bash')
      const ctx = createTestToolUseContext({
        agentId: MAIN_SESSION_ID as any,
      })

      const result = await hasPermissionsToUseTool(
        tool,
        { command: 'npm test' },
        ctx,
        mockParentMessage as any,
        'tu-esc-05',
      )

      expect(result.behavior).toBe('allow')
    })
  })

  // --------------------------------------------------------------------------
  // Precedence: deny rules win over escalation
  // --------------------------------------------------------------------------
  describe('precedence: deny rules win over escalation', () => {
    it('tool with deny rule + active escalation still returns deny', async () => {
      grantEscalation({
        contextId: MAIN_SESSION_ID,
        toolName: 'Bash',
        grantedAt: Date.now(),
        reason: 'test escalation',
      })

      const tool = createMockTool('Bash')
      const ctx = createTestToolUseContext({
        agentId: MAIN_SESSION_ID as any,
        getAppState: () =>
          ({
            toolPermissionContext: {
              ...getEmptyToolPermissionContext(),
              alwaysDenyRules: { session: ['Bash'] },
            },
          }) as AppState,
      })

      const result = await hasPermissionsToUseTool(
        tool,
        { command: 'npm test' },
        ctx,
        mockParentMessage as any,
        'tu-esc-06',
      )

      expect(result.behavior).toBe('deny')
    })
  })

  // --------------------------------------------------------------------------
  // contextId isolation
  // --------------------------------------------------------------------------
  describe('contextId isolation', () => {
    it('forked agent with different agentId does not see parent grants', async () => {
      grantEscalation({
        contextId: MAIN_SESSION_ID,
        toolName: 'Bash',
        grantedAt: Date.now(),
        reason: 'test escalation',
      })

      const tool = createMockTool('Bash')
      const ctx = createTestToolUseContext({
        agentId: FORKED_AGENT_ID as any,
      })

      const result = await hasPermissionsToUseTool(
        tool,
        { command: 'npm test' },
        ctx,
        mockParentMessage as any,
        'tu-esc-07',
      )

      // Forked agent can't see main session's escalation
      expect(result.behavior).toBe('ask')
    })
  })

  // --------------------------------------------------------------------------
  // ruleContent granularity
  // --------------------------------------------------------------------------
  describe('ruleContent granularity', () => {
    it('escalation with ruleContent matches specific tool+content', async () => {
      grantEscalation({
        contextId: MAIN_SESSION_ID,
        toolName: 'Bash',
        ruleContent: 'npm publish:*',
        grantedAt: Date.now(),
        reason: 'test escalation',
      })

      const tool = createMockTool('Bash')
      const ctx = createTestToolUseContext({
        agentId: MAIN_SESSION_ID as any,
      })

      // Matching content
      const result = await hasPermissionsToUseTool(
        tool,
        { command: 'npm publish:*' },
        ctx,
        mockParentMessage as any,
        'tu-esc-08',
      )

      expect(result.behavior).toBe('allow')
    })

    it('non-matching ruleContent returns ask (no wildcard grant)', async () => {
      grantEscalation({
        contextId: MAIN_SESSION_ID,
        toolName: 'Bash',
        ruleContent: 'npm publish:*',
        grantedAt: Date.now(),
        reason: 'test escalation',
      })

      const tool = createMockTool('Bash')
      const ctx = createTestToolUseContext({
        agentId: MAIN_SESSION_ID as any,
      })

      // Different content -- no wildcard grant exists
      const result = await hasPermissionsToUseTool(
        tool,
        { command: 'npm test' },
        ctx,
        mockParentMessage as any,
        'tu-esc-09',
      )

      expect(result.behavior).toBe('ask')
    })
  })

  // --------------------------------------------------------------------------
  // PERM-05: no persistence -- revoke clears grants
  // --------------------------------------------------------------------------
  describe('PERM-05: no persistence', () => {
    it('after revokeAllEscalations, hasPermissionsToUseTool returns ask', async () => {
      grantEscalation({
        contextId: MAIN_SESSION_ID,
        toolName: 'Bash',
        grantedAt: Date.now(),
        reason: 'test escalation',
      })

      // Verify grant is active first
      const tool = createMockTool('Bash')
      const ctx = createTestToolUseContext({
        agentId: MAIN_SESSION_ID as any,
      })

      const resultBefore = await hasPermissionsToUseTool(
        tool,
        { command: 'npm test' },
        ctx,
        mockParentMessage as any,
        'tu-esc-10a',
      )
      expect(resultBefore.behavior).toBe('allow')

      // Revoke and verify
      revokeAllEscalations()

      const resultAfter = await hasPermissionsToUseTool(
        tool,
        { command: 'npm test' },
        ctx,
        mockParentMessage as any,
        'tu-esc-10b',
      )
      expect(resultAfter.behavior).toBe('ask')
    })
  })

  // --------------------------------------------------------------------------
  // Consistency with other callers (structural validation)
  // --------------------------------------------------------------------------
  describe('consistency with other callers', () => {
    it('escalation check is inside hasPermissionsToUseToolInner (not toolExecution.ts)', async () => {
      // Structural verification: the escalation import is in permissions.ts
      const fs = await import('fs')
      const permissionsSource = fs.readFileSync(
        'src/utils/permissions/permissions.ts',
        'utf-8',
      )
      // The hasEscalation call must be inside permissions.ts
      expect(permissionsSource).toContain('hasEscalation')
      expect(permissionsSource).toContain("from './escalation/EscalationStore")
      // Step 2c comment must be present
      expect(permissionsSource).toMatch(/2c.*escalation/i)
    })
  })
})
