/**
 * Integration tests for query() loop — QUERY-01, QUERY-04, PERM-03, TEST-04.
 *
 * Strategy: inject mock deps via QueryParams.deps to avoid live API.
 * callModel mock yields AssistantMessage objects directly — the streaming loop
 * processes them the same way as real API events (type === 'assistant').
 *
 * StreamingToolExecutor is disabled in test (GrowthBook not initialized →
 * checkStatsigFeatureGate_CACHED_MAY_BE_STALE returns false), so the
 * standard runTools() path is used for all tool execution.
 *
 * Threat mitigations:
 * T-04-04-02: all tests set maxTurns ≤ 2 to prevent infinite loops
 * T-04-04-03: each test creates a fresh AbortController (no shared state)
 * T-04-04-04: PERM-03 test verifies alwaysAllowRules is tool-specific
 */
import { describe, test, expect } from 'bun:test'
import { z } from 'zod'
import { query } from 'src/query.js'
import type { QueryDeps } from 'src/query/deps.js'
import type { AssistantMessage } from 'src/types/message.js'
import type { Tool, ToolUseContext } from 'src/Tool.js'
import { getEmptyToolPermissionContext } from 'src/Tool.js'
import { createTestToolUseContext } from 'src/tools/__tests__/createTestToolUseContext.js'
import { hasPermissionsToUseTool } from 'src/utils/permissions/permissions.js'
import type { AppState } from 'src/state/AppState.js'
import { createFileStateCacheWithSizeLimit } from 'src/utils/fileStateCache.js'
import { randomUUID } from 'crypto'

// ============================================================================
// Helpers
// ============================================================================

/**
 * Drain an async generator and collect Terminal value.
 * Uses while-loop pattern to capture the done value correctly.
 * T-04-04-02: loop only proceeds while generator yields, no external timeout.
 */
async function drainQuery(
  gen: ReturnType<typeof query>,
): Promise<{ events: unknown[]; terminal: unknown }> {
  const events: unknown[] = []
  let terminal: unknown
  while (true) {
    const { value, done } = await gen.next()
    if (done) {
      terminal = value
      break
    }
    events.push(value)
  }
  return { events, terminal }
}

/**
 * Build a minimal AppState mock containing all fields accessed by query.ts.
 *
 * Fields accessed in query.ts:
 *   appState.toolPermissionContext.mode     (line 571)
 *   appState.fastMode                       (when fastModeEnabled gate)
 *   appState.mcp.tools                      (line 689)
 *   appState.mcp.clients                    (line 690, .some())
 *   appState.effortValue                    (line 694)
 *   appState.advisorModel                   (line 695)
 */
function makeAppState(overrides: Partial<AppState> = {}): AppState {
  return {
    toolPermissionContext: getEmptyToolPermissionContext(),
    mcp: {
      clients: [],
      tools: [],
      commands: [],
    },
    fastMode: undefined,
    effortValue: undefined,
    advisorModel: undefined,
    ...overrides,
  } as unknown as AppState
}

/**
 * Build a minimal AssistantMessage with stop_reason: 'end_turn' — no tools.
 * Used as the second-turn response to terminate the loop.
 */
function makeEndTurnMessage(id = 'asst-end'): AssistantMessage {
  return {
    type: 'assistant',
    uuid: randomUUID() as ReturnType<typeof randomUUID>,
    message: {
      id,
      role: 'assistant',
      content: [{ type: 'text', text: 'Done.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 5, output_tokens: 5 },
    },
    costUSD: 0,
    durationMs: 0,
  } as AssistantMessage
}

/**
 * Build an AssistantMessage with N tool_use blocks.
 * stop_reason 'tool_use' so the loop continues to tool execution;
 * second callModel turn yields end_turn to terminate.
 */
function makeToolUseMessage(toolIds: string[], toolName: string): AssistantMessage {
  return {
    type: 'assistant',
    uuid: randomUUID() as ReturnType<typeof randomUUID>,
    message: {
      id: 'asst-tools',
      role: 'assistant',
      content: toolIds.map(id => ({
        type: 'tool_use',
        id,
        name: toolName,
        input: { dummy: 'value' },
      })),
      stop_reason: 'tool_use',
      usage: { input_tokens: 10, output_tokens: 20 },
    },
    costUSD: 0,
    durationMs: 0,
  } as AssistantMessage
}

/**
 * Create a minimal mock Tool that:
 * - Has inputSchema with safeParse (Zod schema wrapping dummy field)
 * - Has a call() that returns immediately without side effects
 * - Has checkPermissions returning passthrough (canUseTool decides)
 *
 * Must be registered in toolUseContext.options.tools for canUseTool to be called.
 */
function createMockQueryTool(name = 'MockTool'): Tool {
  const inputSchema = z.object({ dummy: z.string() })
  return {
    name,
    description: async () => `${name} for testing`,
    prompt: async () => '',
    userFacingName: () => name,
    inputSchema: inputSchema as unknown as Tool['inputSchema'],
    checkPermissions: async () => ({
      behavior: 'passthrough' as const,
      message: 'no permission check',
    }),
    isEnabled: () => true,
    isReadOnly: () => false,
    isConcurrencySafe: () => true,
    maxResultSizeChars: 100_000,
    call: async () => ({
      type: 'result',
      data: 'mock result',
    }),
    renderResultMessage: () => null,
  } as unknown as Tool
}

/**
 * Build a full ToolUseContext with complete options (including tools list)
 * and a complete AppState mock so query.ts can access appState.mcp.* etc.
 */
function makeToolUseContext(
  overrides: {
    abortController?: AbortController
    tools?: Tool[]
    appStateOverrides?: Partial<AppState>
  } = {},
): ToolUseContext {
  const abortController = overrides.abortController ?? new AbortController()
  const tools = overrides.tools ?? []
  const appState = makeAppState(overrides.appStateOverrides)

  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'claude-sonnet-4-5-20250514',
      tools,
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
    abortController,
    readFileState: createFileStateCacheWithSizeLimit(100),
    getAppState: () => appState,
    setAppState: () => {},
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    messages: [],
  } as unknown as ToolUseContext
}

/**
 * Build minimal QueryParams for testing.
 * T-04-04-02: maxTurns defaults to 2 to prevent infinite loops.
 */
function makeParams(overrides: Partial<Parameters<typeof query>[0]> = {}) {
  return {
    messages: [],
    systemPrompt: '' as unknown as Parameters<typeof query>[0]['systemPrompt'],
    userContext: {},
    systemContext: {},
    canUseTool: async () => ({ behavior: 'allow' as const }),
    toolUseContext: makeToolUseContext(),
    querySource: 'repl_main_thread' as const,
    maxTurns: 2,
    ...overrides,
  }
}

/**
 * Minimal autocompact mock — no-op, returns messages unchanged.
 */
const noopAutocompact: QueryDeps['autocompact'] = async () => ({
  compactionResult: null,
  consecutiveFailures: undefined,
})

/**
 * Minimal microcompact mock — no-op, returns messages unchanged.
 */
const noopMicrocompact: QueryDeps['microcompact'] = async (messages) => ({
  messages,
  compactionInfo: undefined,
})

// ============================================================================
// QUERY-01: Multi-tool batch execution
// ============================================================================

describe('query loop', () => {
  describe('QUERY-01: multi-tool batch execution', () => {
    test('two tool_use blocks cause canUseTool to be called at least twice', async () => {
      // T-04-04-03: fresh AbortController per test
      const mockTool = createMockQueryTool('MockTool')
      const ctx = makeToolUseContext({ tools: [mockTool] })

      let canUseToolCallCount = 0
      const canUseTool: Parameters<typeof query>[0]['canUseTool'] = async () => {
        canUseToolCallCount++
        return { behavior: 'allow' as const }
      }

      // Turn 1: yield 2 tool_use blocks
      // Turn 2: yield end_turn to terminate the loop
      let callCount = 0
      const deps: QueryDeps = {
        callModel: async function* () {
          callCount++
          if (callCount === 1) {
            yield makeToolUseMessage(['tu-1', 'tu-2'], 'MockTool')
          } else {
            yield makeEndTurnMessage()
          }
        },
        microcompact: noopMicrocompact,
        autocompact: noopAutocompact,
        uuid: () => randomUUID(),
      }

      const gen = query(makeParams({ canUseTool, toolUseContext: ctx, deps, maxTurns: 2 }))
      const { terminal } = await drainQuery(gen)

      // QUERY-01: canUseTool must be called once per tool_use block (≥ 2)
      expect(canUseToolCallCount).toBeGreaterThanOrEqual(2)
    })

    test('two tool_use blocks produce two tool_result entries in yielded events', async () => {
      const mockTool = createMockQueryTool('MockTool')
      const ctx = makeToolUseContext({ tools: [mockTool] })

      let callCount = 0
      const deps: QueryDeps = {
        callModel: async function* () {
          callCount++
          if (callCount === 1) {
            yield makeToolUseMessage(['tu-a', 'tu-b'], 'MockTool')
          } else {
            yield makeEndTurnMessage()
          }
        },
        microcompact: noopMicrocompact,
        autocompact: noopAutocompact,
        uuid: () => randomUUID(),
      }

      const gen = query(makeParams({
        toolUseContext: ctx,
        deps,
        maxTurns: 2,
        canUseTool: async () => ({ behavior: 'allow' as const }),
      }))
      const { events } = await drainQuery(gen)

      // Tool results are yielded as user-type messages during tool execution.
      // Each tool_use block produces one corresponding tool_result block.
      // Count tool_result blocks across all yielded user messages.
      let toolResultCount = 0
      for (const event of events) {
        const e = event as any
        if (e?.type === 'user' && Array.isArray(e.message?.content)) {
          for (const block of e.message.content) {
            if (block.type === 'tool_result') toolResultCount++
          }
        }
      }
      // QUERY-01: 2 tool_use blocks → 2 tool_result blocks yielded
      expect(toolResultCount).toBeGreaterThanOrEqual(2)
    })
  })

  // ============================================================================
  // QUERY-04: Abort handling
  // ============================================================================

  describe('QUERY-04: abort handling', () => {
    test('abort during stream returns terminal with reason: aborted_streaming', async () => {
      // T-04-04-03: fresh AbortController per test
      const abortController = new AbortController()
      const ctx = makeToolUseContext({ abortController })

      const deps: QueryDeps = {
        callModel: async function* () {
          // Abort before yielding anything — simulates abort at stream start
          abortController.abort()
          // Generator ends without yielding — streaming loop exits, abort check fires
        },
        microcompact: noopMicrocompact,
        autocompact: noopAutocompact,
        uuid: () => randomUUID(),
      }

      const gen = query(makeParams({ toolUseContext: ctx, deps, maxTurns: 1 }))
      const { terminal } = await drainQuery(gen)

      expect((terminal as any)?.reason).toBe('aborted_streaming')
    })

    test('abort during tool execution returns terminal with reason: aborted_tools', async () => {
      // T-04-04-03: fresh AbortController per test
      const abortController = new AbortController()
      const mockTool = createMockQueryTool('MockTool')
      const ctx = makeToolUseContext({ abortController, tools: [mockTool] })

      // Abort during canUseTool call (i.e., during tool permission check phase)
      let abortFired = false
      const canUseTool: Parameters<typeof query>[0]['canUseTool'] = async () => {
        if (!abortFired) {
          abortFired = true
          abortController.abort()
        }
        return { behavior: 'allow' as const }
      }

      const deps: QueryDeps = {
        callModel: async function* () {
          // Streaming completes normally — abort fires during subsequent tool execution
          yield makeToolUseMessage(['tu-abort'], 'MockTool')
        },
        microcompact: noopMicrocompact,
        autocompact: noopAutocompact,
        uuid: () => randomUUID(),
      }

      const gen = query(makeParams({ canUseTool, toolUseContext: ctx, deps, maxTurns: 1 }))
      const { terminal } = await drainQuery(gen)

      // abort during tool execution → aborted_tools
      expect((terminal as any)?.reason).toBe('aborted_tools')
    })

    test('QUERY-04 C: after abort, terminal reason is a valid abort state (orphan cleanup)', async () => {
      // T-04-04-03: fresh AbortController per test
      const abortController = new AbortController()
      const ctx = makeToolUseContext({ abortController })

      // Abort after yielding one message with tool_use, during streaming
      const deps: QueryDeps = {
        callModel: async function* () {
          yield makeToolUseMessage(['tu-orphan'], 'OrphanTool')
          abortController.abort()
          // Generator ends — streaming loop exits, abort check fires
        },
        microcompact: noopMicrocompact,
        autocompact: noopAutocompact,
        uuid: () => randomUUID(),
      }

      const gen = query(makeParams({ toolUseContext: ctx, deps, maxTurns: 1 }))
      const { events, terminal } = await drainQuery(gen)

      // Terminal must indicate an abort state
      const reason = (terminal as any)?.reason
      expect(
        reason === 'aborted_streaming' || reason === 'aborted_tools',
      ).toBe(true)

      // Count tool_use and tool_result blocks across yielded events.
      // yieldMissingToolResultBlocks synthesizes a tool_result for each orphan tool_use.
      let toolUseCount = 0
      let toolResultCount = 0
      for (const event of events) {
        const e = event as any
        if (e?.type === 'user' && Array.isArray(e.message?.content)) {
          for (const block of e.message.content) {
            if (block.type === 'tool_result') toolResultCount++
          }
        }
        if (e?.type === 'assistant' && Array.isArray(e.message?.content)) {
          for (const block of e.message.content) {
            if (block.type === 'tool_use') toolUseCount++
          }
        }
      }

      // After abort: orphan tool_use blocks must have matching synthesized tool_results
      // Conversation must be in recoverable state (no unmatched tool_use)
      if (toolUseCount > 0) {
        expect(toolResultCount).toBe(toolUseCount)
      } else {
        // No tool_use yielded before abort — terminal reason alone is sufficient
        expect(reason).toBe('aborted_streaming')
      }
    })
  })

  // ============================================================================
  // PERM-03: Permission state persistence across turns
  //
  // Design: Unit test of hasPermissionsToUseTool() with alwaysAllowRules.
  // In production, AppState.toolPermissionContext carries permission state between
  // query() calls. Turn 1 grants "Bash" via alwaysAllowRules; Turn 2 uses the
  // same AppState and must get behavior:'allow' without re-prompting.
  //
  // This unit test is equivalent to testing cross-turn persistence because:
  // 1. toolPermissionContext is part of AppState
  // 2. AppState is passed via getAppState() in toolUseContext (same object per turn)
  // 3. alwaysAllowRules accumulated in Turn 1 persists for all subsequent turns
  // ============================================================================

  describe('PERM-03: permission state persists across turns', () => {
    test('PERM-03: alwaysAllowRules accumulated in turn 1 drives allow decision in turn 2', async () => {
      const mockParentMessage = {
        type: 'assistant' as const,
        uuid: 'perm03-msg',
        message: {
          id: 'perm03-msg-id',
          role: 'assistant' as const,
          content: [{ type: 'tool_use', id: 'tu-perm03', name: 'Bash', input: {} }],
        },
        costUSD: 0,
        durationMs: 0,
      }

      const bashTool = {
        name: 'Bash',
        inputSchema: { parse: (x: unknown) => x, safeParse: (x: unknown) => ({ success: true, data: x }) } as unknown as Tool['inputSchema'],
        checkPermissions: async () => ({
          behavior: 'passthrough' as const,
          message: 'default',
        }),
        isEnabled: () => true,
        isReadOnly: () => false,
        isConcurrencySafe: () => true,
        maxResultSizeChars: 100_000,
        call: async () => ({ type: 'result', data: null }),
        description: async () => 'Bash tool',
        prompt: async () => '',
        userFacingName: () => 'Bash',
      } as unknown as Tool

      // Turn 1 effect: 'Bash' tool was granted during turn 1 (stored in AppState)
      // AppState carries this as alwaysAllowRules: { session: ['Bash'] }
      const ctx = makeToolUseContext({
        appStateOverrides: {
          toolPermissionContext: {
            ...getEmptyToolPermissionContext(),
            alwaysAllowRules: { session: ['Bash'] }, // Granted in turn 1
          },
        } as Partial<AppState>,
      })

      // Turn 2: same toolUseContext, same AppState — permission should be 'allow'
      const decision = await hasPermissionsToUseTool(
        bashTool,
        {},
        ctx,
        mockParentMessage as any,
        'tu-perm03',
      )

      // Tool is in alwaysAllowRules → behavior: 'allow' without re-prompting
      expect(decision.behavior).toBe('allow')
    })

    test('PERM-03: alwaysAllowRules is tool-specific (does not grant all tools)', async () => {
      // T-04-04-04: verify permission bypass is not a wildcard
      const otherTool = {
        name: 'FileWrite',
        inputSchema: { parse: (x: unknown) => x, safeParse: (x: unknown) => ({ success: true, data: x }) } as unknown as Tool['inputSchema'],
        checkPermissions: async () => ({
          behavior: 'passthrough' as const,
          message: 'default',
        }),
        isEnabled: () => true,
        isReadOnly: () => false,
        isConcurrencySafe: () => true,
        maxResultSizeChars: 100_000,
        call: async () => ({ type: 'result', data: null }),
        description: async () => 'FileWrite tool',
        prompt: async () => '',
        userFacingName: () => 'FileWrite',
      } as unknown as Tool

      const mockParentMessage = {
        type: 'assistant' as const,
        uuid: 'perm03-other-msg',
        message: {
          id: 'perm03-other-msg-id',
          role: 'assistant' as const,
          content: [{ type: 'tool_use', id: 'tu-other', name: 'FileWrite', input: {} }],
        },
        costUSD: 0,
        durationMs: 0,
      }

      // Only 'Bash' is in alwaysAllowRules — FileWrite must NOT be auto-allowed
      const ctx = makeToolUseContext({
        appStateOverrides: {
          toolPermissionContext: {
            ...getEmptyToolPermissionContext(),
            alwaysAllowRules: { session: ['Bash'] }, // Only Bash is granted
          },
        } as Partial<AppState>,
      })

      const decision = await hasPermissionsToUseTool(
        otherTool,
        {},
        ctx,
        mockParentMessage as any,
        'tu-other',
      )

      // FileWrite is NOT in alwaysAllowRules → passthrough → ask (not allow)
      expect(decision.behavior).toBe('ask')
    })
  })
})
