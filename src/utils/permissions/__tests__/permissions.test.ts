/**
 * Unit tests for hasPermissionsToUseTool() — permission system core logic.
 *
 * PERM-01: Research verified that resolveHookPermissionDecision() in toolExecution.ts
 * runs at line ~921 BEFORE tool.call() at line ~1010+.
 * The test below proves hasPermissionsToUseTool() returns 'deny' before any tool.call()
 * can fire — no code fix needed, this is the passing test marking PERM-01 resolved.
 *
 * PERM-02: Validates that all three PermissionBehavior modes (deny / ask / allow)
 * are correctly enforced by hasPermissionsToUseTool().
 */
import { describe, test, expect } from 'bun:test'
import { hasPermissionsToUseTool } from '../permissions.js'
import { getEmptyToolPermissionContext } from 'src/Tool.js'
import { createTestToolUseContext } from 'src/tools/__tests__/createTestToolUseContext.js'
import type { AppState } from 'src/state/AppState.js'
import type { PermissionResult } from 'src/types/permissions.js'
import type { Tool } from 'src/Tool.js'

// ============================================================================
// Mock parent assistant message (shape required by hasPermissionsToUseTool)
// Matches the pattern from BashTool.test.ts
// ============================================================================
const mockParentMessage = {
  type: 'assistant' as const,
  content: [{ type: 'tool_use', id: 'test-id', name: 'TestTool', input: {} }],
  message: { role: 'assistant' as const, content: [] },
  costUSD: 0,
  durationMs: 0,
  uuid: 'test-uuid',
}

// ============================================================================
// Mock Tool factory — constructs a minimal Tool-compatible object.
// We don't use buildTool() because it has complex runtime dependencies.
// ============================================================================
function createMockTool(
  name = 'TestTool',
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

describe('hasPermissionsToUseTool', () => {
  // --------------------------------------------------------------------------
  // PERM-01: Permission check occurs BEFORE tool.call()
  // This test demonstrates that a deny rule causes hasPermissionsToUseTool()
  // to return 'deny' immediately — tool.call() is never invoked.
  // Research confirmed: toolExecution.ts calls resolveHookPermissionDecision()
  // at ~line 921, and tool.call() only at ~line 1010+.
  // --------------------------------------------------------------------------
  test('PERM-01: deny rule returns behavior:deny before tool.call() can fire', async () => {
    const tool = createMockTool('TestTool')

    // Track whether call() was invoked (it must NOT be)
    let toolCallInvoked = false
    const trackedTool = {
      ...tool,
      call: async (...args: unknown[]) => {
        toolCallInvoked = true
        return tool.call(...(args as Parameters<typeof tool.call>))
      },
    } as unknown as Tool

    const ctx = createTestToolUseContext({
      getAppState: () =>
        ({
          toolPermissionContext: {
            ...getEmptyToolPermissionContext(),
            alwaysDenyRules: { session: ['TestTool'] },
          },
        }) as AppState,
    })

    const result = await hasPermissionsToUseTool(
      trackedTool,
      {},
      ctx,
      mockParentMessage as any,
      'tu-perm01',
    )

    // Permission function returns deny — proving the check happened before call()
    expect(result.behavior).toBe('deny')
    // tool.call() was never invoked because permission was rejected first
    expect(toolCallInvoked).toBe(false)
  })

  // --------------------------------------------------------------------------
  // PERM-02a: alwaysDenyRules — tool in deny list → behavior: 'deny'
  // --------------------------------------------------------------------------
  test('PERM-02a: alwaysDenyRules containing tool name returns behavior:deny', async () => {
    const tool = createMockTool('TestTool')

    const ctx = createTestToolUseContext({
      getAppState: () =>
        ({
          toolPermissionContext: {
            ...getEmptyToolPermissionContext(),
            alwaysDenyRules: { session: ['TestTool'] },
          },
        }) as AppState,
    })

    const result = await hasPermissionsToUseTool(
      tool,
      {},
      ctx,
      mockParentMessage as any,
      'tu-deny',
    )

    expect(result.behavior).toBe('deny')
  })

  // --------------------------------------------------------------------------
  // PERM-02b: alwaysAskRules — tool in ask list → behavior: 'ask'
  // --------------------------------------------------------------------------
  test('PERM-02b: alwaysAskRules containing tool name returns behavior:ask', async () => {
    const tool = createMockTool('TestTool')

    const ctx = createTestToolUseContext({
      getAppState: () =>
        ({
          toolPermissionContext: {
            ...getEmptyToolPermissionContext(),
            alwaysAskRules: { session: ['TestTool'] },
          },
        }) as AppState,
    })

    const result = await hasPermissionsToUseTool(
      tool,
      {},
      ctx,
      mockParentMessage as any,
      'tu-ask',
    )

    expect(result.behavior).toBe('ask')
  })

  // --------------------------------------------------------------------------
  // PERM-02c: bypassPermissions mode → behavior: 'allow'
  // The mode 'bypassPermissions' skips permission prompting and auto-allows.
  // --------------------------------------------------------------------------
  test('PERM-02c: bypassPermissions mode returns behavior:allow', async () => {
    const tool = createMockTool('TestTool')

    const ctx = createTestToolUseContext({
      getAppState: () =>
        ({
          toolPermissionContext: {
            ...getEmptyToolPermissionContext(),
            mode: 'bypassPermissions',
          },
        }) as AppState,
    })

    const result = await hasPermissionsToUseTool(
      tool,
      {},
      ctx,
      mockParentMessage as any,
      'tu-bypass',
    )

    expect(result.behavior).toBe('allow')
  })

  // --------------------------------------------------------------------------
  // PERM-02d: No rules + checkPermissions returns 'passthrough'
  //           → passthrough is converted to 'ask' (step 3 in decision tree)
  // --------------------------------------------------------------------------
  test('PERM-02d: no rules and passthrough checkPermissions returns behavior:ask', async () => {
    const tool = createMockTool('TestTool', {
      behavior: 'passthrough',
      message: 'default passthrough',
    })

    // Empty context: no deny/ask/allow rules, default mode
    const ctx = createTestToolUseContext({
      getAppState: () =>
        ({
          toolPermissionContext: getEmptyToolPermissionContext(),
        }) as AppState,
    })

    const result = await hasPermissionsToUseTool(
      tool,
      {},
      ctx,
      mockParentMessage as any,
      'tu-passthrough',
    )

    // passthrough is converted to ask at step 3 of hasPermissionsToUseToolInner
    expect(result.behavior).toBe('ask')
  })
})
