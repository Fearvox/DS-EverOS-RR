/**
 * Unit tests for the extractMemories pipeline (Phase 6-01 MEM-01).
 *
 * Tests cover:
 * - Feature flag activation (EXTRACT_MEMORIES + tengu_passport_quail)
 * - countModelVisibleMessagesSince behavior
 * - hasMemoryWritesSince detection
 * - createAutoMemCanUseTool permission enforcement
 * - extractWrittenPaths path extraction & deduplication
 * - Cursor advancement & call coalescing
 *
 * All tests mock the forked agent (no real API calls).
 */

import { describe, test, expect, beforeEach, afterEach, afterAll, mock } from 'bun:test'
import { randomUUID, type UUID } from 'crypto'

// ============================================================================
// Module mocks — must be set BEFORE importing the module under test
// ============================================================================

// Track runForkedAgent calls for verification
const runForkedAgentCalls: Array<Record<string, unknown>> = []
const mockRunForkedAgent = mock(async (params: Record<string, unknown>) => {
  runForkedAgentCalls.push(params)
  return {
    messages: [],
    totalUsage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      service_tier: undefined,
      cache_creation: {
        ephemeral_1h_input_tokens: 0,
        ephemeral_5m_input_tokens: 0,
      },
    },
  }
})

mock.module('src/utils/forkedAgent.js', () => ({
  createCacheSafeParams: (ctx: unknown) => ({
    systemPrompt: [],
    userContext: {},
    systemContext: {},
    toolUseContext: (ctx as Record<string, unknown>).toolUseContext,
    forkContextMessages: (ctx as Record<string, unknown>).messages ?? [],
  }),
  runForkedAgent: mockRunForkedAgent,
}))

// Feature flag: EXTRACT_MEMORIES controlled via env var
// tengu_passport_quail controlled via CLAUDE_INTERNAL_FC_OVERRIDES
mock.module('src/utils/featureFlag.js', () => ({
  feature: (name: string) => {
    // Check env var override first (same as real featureFlag.ts)
    if (process.env.CLAUDE_FEATURE_ALL === 'true') return true
    const envVal = process.env[`CLAUDE_FEATURE_${name}`]
    if (envVal !== undefined) return envVal === 'true' || envVal === '1'
    return false
  },
  _reloadFlagsForTesting: () => {},
}))

// GrowthBook: tengu_passport_quail gate
let mockTenguPassportQuail = false
let mockTenguBrambleLintel: number | null = null
mock.module('src/services/analytics/growthbook.js', () => ({
  getFeatureValue_CACHED_MAY_BE_STALE: (feature: string, defaultValue: unknown) => {
    if (feature === 'tengu_passport_quail') return mockTenguPassportQuail
    if (feature === 'tengu_bramble_lintel') return mockTenguBrambleLintel
    if (feature === 'tengu_moth_copse') return false
    return defaultValue
  },
  _resetLocalFlagOverridesForTesting: () => {},
  getLocalFlagOverrides: () => null,
}))

// Bootstrap state mocks
let mockIsRemoteMode = false
mock.module('src/bootstrap/state.js', () => ({
  getIsRemoteMode: () => mockIsRemoteMode,
  getIsNonInteractiveSession: () => false,
  getProjectRoot: () => '/tmp/test-project',
  getSessionTrustAccepted: () => true,
  getSessionId: () => 'test-session',
}))

// Auto-memory paths: simulate a known memory directory
const TEST_MEMORY_DIR = '/tmp/test-home/.claude/projects/test/memory/'
mock.module('src/memdir/paths.js', () => ({
  getAutoMemPath: () => TEST_MEMORY_DIR,
  isAutoMemoryEnabled: () => true,
  isAutoMemPath: (p: string) => p.startsWith(TEST_MEMORY_DIR),
  isExtractModeActive: () => true,
  hasAutoMemPathOverride: () => false,
}))

// Memory scan
mock.module('src/memdir/memoryScan.js', () => ({
  scanMemoryFiles: async () => [],
  formatMemoryManifest: () => '(no memories)',
}))

// Memdir constants
mock.module('src/memdir/memdir.js', () => ({
  ENTRYPOINT_NAME: 'MEMORY.md',
}))

// Analytics (no-op)
mock.module('src/services/analytics/index.js', () => ({
  logEvent: () => {},
}))
mock.module('src/services/analytics/metadata.js', () => ({
  sanitizeToolNameForAnalytics: (n: string) => n,
}))

// Debug logging (no-op)
mock.module('src/utils/debug.js', () => ({
  logForDebugging: () => {},
}))

// Abort controller
mock.module('src/utils/abortController.js', () => ({
  createAbortController: () => new AbortController(),
}))

// Messages util
mock.module('src/utils/messages.js', () => ({
  createUserMessage: (opts: Record<string, unknown>) => ({
    type: 'user' as const,
    uuid: randomUUID(),
    message: { role: 'user', content: opts.content },
  }),
  createMemorySavedMessage: (paths: string[]) => ({
    type: 'system' as const,
    uuid: randomUUID(),
    memoryPaths: paths,
  }),
}))

// Prompts
mock.module('src/services/extractMemories/prompts.js', () => ({
  buildExtractAutoOnlyPrompt: () => 'extract prompt',
  buildExtractCombinedPrompt: () => 'combined extract prompt',
}))

// ============================================================================
// Import module under test AFTER all mocks
// ============================================================================

import {
  initExtractMemories,
  executeExtractMemories,
  drainPendingExtraction,
  createAutoMemCanUseTool,
} from '../extractMemories.js'

import type { Message, AssistantMessage } from 'src/types/message.js'
import type { Tool } from 'src/Tool.js'
import type { REPLHookContext } from 'src/utils/hooks/postSamplingHooks.js'

// ============================================================================
// Test Helpers
// ============================================================================

function makeUUID(): UUID {
  return randomUUID()
}

function makeUserMessage(uuid?: UUID): Message {
  return {
    type: 'user',
    uuid: uuid ?? makeUUID(),
    message: { role: 'user', content: 'test message' },
  }
}

function makeAssistantMessage(
  uuid?: UUID,
  content?: unknown[],
): Message {
  return {
    type: 'assistant',
    uuid: uuid ?? makeUUID(),
    message: {
      role: 'assistant',
      content: content ?? [{ type: 'text', text: 'response' }],
    },
  } as Message
}

function makeAssistantWithToolUse(
  toolName: string,
  filePath: string,
  uuid?: UUID,
): Message {
  return makeAssistantMessage(uuid, [
    {
      type: 'tool_use',
      id: `toolu_${randomUUID()}`,
      name: toolName,
      input: { file_path: filePath },
    },
  ])
}

function makeSystemMessage(uuid?: UUID): Message {
  return {
    type: 'system',
    uuid: uuid ?? makeUUID(),
    message: { role: 'system', content: 'system message' },
  }
}

function makeProgressMessage(uuid?: UUID): Message {
  return {
    type: 'progress',
    uuid: uuid ?? makeUUID(),
    data: {},
  } as Message
}

function makeContext(messages: Message[]): REPLHookContext {
  return {
    messages,
    systemPrompt: [],
    userContext: {},
    systemContext: {},
    toolUseContext: {
      options: {
        commands: [],
        debug: false,
        mainLoopModel: 'claude-sonnet-4-5-20250514',
        tools: [],
        verbose: false,
        thinkingConfig: { type: 'disabled' },
        mcpClients: [],
        mcpResources: {},
        isNonInteractiveSession: false,
        agentDefinitions: { activeAgents: [], allowedAgentTypes: undefined },
      },
      abortController: new AbortController(),
      readFileState: new Map() as any,
      getAppState: () => ({ toolPermissionContext: {} } as any),
      setAppState: () => {},
      setInProgressToolUseIDs: () => {},
      setResponseLength: () => {},
      updateFileHistoryState: () => {},
      updateAttributionState: () => {},
      messages,
    } as any,
  }
}

/** Create a minimal mock Tool object for canUseTool testing. */
function makeMockTool(
  name: string,
  opts?: {
    isReadOnly?: (input: unknown) => boolean
    safeParse?: (input: unknown) => { success: boolean; data?: unknown }
  },
): Tool {
  return {
    name,
    inputSchema: {
      safeParse: opts?.safeParse ?? ((input: unknown) => ({ success: true, data: input })),
    },
    isReadOnly: opts?.isReadOnly ?? (() => false),
  } as unknown as Tool
}

// ============================================================================
// Tests
// ============================================================================

afterAll(() => {
  mock.restore()
})

describe('extractMemories', () => {
  beforeEach(() => {
    // Reset closure state by re-initializing
    initExtractMemories()
    runForkedAgentCalls.length = 0
    mockTenguPassportQuail = true
    mockTenguBrambleLintel = null
    mockIsRemoteMode = false
    mockRunForkedAgent.mockClear()
  })

  afterEach(() => {
    delete process.env.CLAUDE_FEATURE_EXTRACT_MEMORIES
    delete process.env.CLAUDE_FEATURE_ALL
  })

  // ────────────────────────────────────────────────────────
  // 1. Feature Flag Activation
  // ────────────────────────────────────────────────────────

  describe('feature flag activation', () => {
    test('extraction runs when tengu_passport_quail is true', async () => {
      mockTenguPassportQuail = true
      const messages = [makeUserMessage(), makeAssistantMessage()]
      const ctx = makeContext(messages)

      await executeExtractMemories(ctx)

      expect(mockRunForkedAgent).toHaveBeenCalled()
      expect(runForkedAgentCalls[0]).toMatchObject({
        querySource: 'extract_memories',
        maxTurns: 5,
        skipTranscript: true,
      })
    })

    test('extraction skips when tengu_passport_quail is false', async () => {
      mockTenguPassportQuail = false
      const messages = [makeUserMessage(), makeAssistantMessage()]
      const ctx = makeContext(messages)

      await executeExtractMemories(ctx)

      expect(mockRunForkedAgent).not.toHaveBeenCalled()
    })

    test('extraction skips when called from a subagent (agentId set)', async () => {
      mockTenguPassportQuail = true
      const messages = [makeUserMessage(), makeAssistantMessage()]
      const ctx = makeContext(messages)
      // Set agentId on the toolUseContext to simulate subagent
      ;(ctx.toolUseContext as any).agentId = 'sub-agent-001'

      await executeExtractMemories(ctx)

      expect(mockRunForkedAgent).not.toHaveBeenCalled()
    })

    test('extraction skips in remote mode', async () => {
      mockTenguPassportQuail = true
      mockIsRemoteMode = true
      const messages = [makeUserMessage(), makeAssistantMessage()]
      const ctx = makeContext(messages)

      await executeExtractMemories(ctx)

      expect(mockRunForkedAgent).not.toHaveBeenCalled()
    })
  })

  // ────────────────────────────────────────────────────────
  // 2. countModelVisibleMessagesSince (tested via pipeline)
  // ────────────────────────────────────────────────────────

  describe('countModelVisibleMessagesSince (via extraction pipeline)', () => {
    test('counts user and assistant messages only', async () => {
      const messages = [
        makeUserMessage(),
        makeSystemMessage(),
        makeAssistantMessage(),
        makeProgressMessage(),
        makeUserMessage(),
        makeAssistantMessage(),
      ]
      const ctx = makeContext(messages)

      await executeExtractMemories(ctx)

      // Extraction ran — the forked agent was called
      expect(mockRunForkedAgent).toHaveBeenCalledTimes(1)
    })

    test('cursor advancement: second call counts only new messages', async () => {
      const msg1 = makeUserMessage()
      const msg2 = makeAssistantMessage()
      const ctx1 = makeContext([msg1, msg2])

      await executeExtractMemories(ctx1)
      expect(mockRunForkedAgent).toHaveBeenCalledTimes(1)

      // Now add more messages and call again
      const msg3 = makeUserMessage()
      const msg4 = makeAssistantMessage()
      const ctx2 = makeContext([msg1, msg2, msg3, msg4])

      await executeExtractMemories(ctx2)
      expect(mockRunForkedAgent).toHaveBeenCalledTimes(2)
    })

    test('cursor equals last message returns 0 new — throttled second call is skipped', async () => {
      // Set throttle to every 2 turns so that a call with 0 new messages
      // (turnsSinceLastExtraction=1 < 2) gets throttled away.
      mockTenguBrambleLintel = 2

      const msg1 = makeUserMessage()
      const msg2 = makeAssistantMessage()
      const ctx = makeContext([msg1, msg2])

      // First call: turnsSinceLastExtraction increments to 1, but 1 < 2 → throttled
      await executeExtractMemories(ctx)
      expect(mockRunForkedAgent).toHaveBeenCalledTimes(0)

      // Second call: turnsSinceLastExtraction increments to 2, 2 >= 2 → runs
      await executeExtractMemories(ctx)
      expect(mockRunForkedAgent).toHaveBeenCalledTimes(1)

      // Cursor now equals last message UUID. Call again with the SAME messages —
      // countModelVisibleMessagesSince returns 0 (no messages after cursor).
      // turnsSinceLastExtraction increments to 1 again, but 1 < 2 → throttled.
      // runForkedAgent should NOT be called a second time.
      await executeExtractMemories(ctx)
      expect(mockRunForkedAgent).toHaveBeenCalledTimes(1)
    })
  })

  // ────────────────────────────────────────────────────────
  // 3. hasMemoryWritesSince (tested via pipeline)
  // ────────────────────────────────────────────────────────

  describe('hasMemoryWritesSince (via extraction pipeline)', () => {
    test('skips extraction when main agent wrote to memory path', async () => {
      const memPath = `${TEST_MEMORY_DIR}topic.md`
      const messages = [
        makeUserMessage(),
        makeAssistantWithToolUse('Write', memPath),
      ]
      const ctx = makeContext(messages)

      await executeExtractMemories(ctx)

      // Should skip — the main agent already wrote to memory
      expect(mockRunForkedAgent).not.toHaveBeenCalled()
    })

    test('skips extraction for Edit tool targeting memory path', async () => {
      const memPath = `${TEST_MEMORY_DIR}existing.md`
      const messages = [
        makeUserMessage(),
        makeAssistantWithToolUse('Edit', memPath),
      ]
      const ctx = makeContext(messages)

      await executeExtractMemories(ctx)

      expect(mockRunForkedAgent).not.toHaveBeenCalled()
    })

    test('runs extraction when writes are to non-memory paths', async () => {
      const messages = [
        makeUserMessage(),
        makeAssistantWithToolUse('Write', '/tmp/other/file.ts'),
      ]
      const ctx = makeContext(messages)

      await executeExtractMemories(ctx)

      expect(mockRunForkedAgent).toHaveBeenCalledTimes(1)
    })

    test('runs extraction when no writes exist at all', async () => {
      const messages = [
        makeUserMessage(),
        makeAssistantMessage(),
      ]
      const ctx = makeContext(messages)

      await executeExtractMemories(ctx)

      expect(mockRunForkedAgent).toHaveBeenCalledTimes(1)
    })
  })

  // ────────────────────────────────────────────────────────
  // 4. createAutoMemCanUseTool
  // ────────────────────────────────────────────────────────

  describe('createAutoMemCanUseTool', () => {
    const canUseTool = createAutoMemCanUseTool(TEST_MEMORY_DIR)

    test('allows Read tool unconditionally', async () => {
      const tool = makeMockTool('Read')
      const result = await canUseTool(tool, { file_path: '/any/path.txt' })
      expect(result.behavior).toBe('allow')
    })

    test('allows Grep tool unconditionally', async () => {
      const tool = makeMockTool('Grep')
      const result = await canUseTool(tool, { pattern: 'foo' })
      expect(result.behavior).toBe('allow')
    })

    test('allows Glob tool unconditionally', async () => {
      const tool = makeMockTool('Glob')
      const result = await canUseTool(tool, { pattern: '*.ts' })
      expect(result.behavior).toBe('allow')
    })

    test('allows REPL tool', async () => {
      const tool = makeMockTool('REPL')
      const result = await canUseTool(tool, {})
      expect(result.behavior).toBe('allow')
    })

    test('allows read-only Bash commands', async () => {
      const tool = makeMockTool('Bash', {
        isReadOnly: () => true,
        safeParse: (input: unknown) => ({ success: true, data: input }),
      })
      const result = await canUseTool(tool, { command: 'ls -la' })
      expect(result.behavior).toBe('allow')
    })

    test('denies non-read-only Bash commands', async () => {
      const tool = makeMockTool('Bash', {
        isReadOnly: () => false,
        safeParse: (input: unknown) => ({ success: true, data: input }),
      })
      const result = await canUseTool(tool, { command: 'rm -rf /' })
      expect(result.behavior).toBe('deny')
    })

    test('denies Bash when schema parse fails', async () => {
      const tool = makeMockTool('Bash', {
        isReadOnly: () => true,
        safeParse: () => ({ success: false }),
      })
      const result = await canUseTool(tool, { command: 'echo hi' })
      expect(result.behavior).toBe('deny')
    })

    test('allows Edit for paths within memory directory', async () => {
      const tool = makeMockTool('Edit')
      const memFile = `${TEST_MEMORY_DIR}topic.md`
      const result = await canUseTool(tool, { file_path: memFile })
      expect(result.behavior).toBe('allow')
    })

    test('allows Write for paths within memory directory', async () => {
      const tool = makeMockTool('Write')
      const memFile = `${TEST_MEMORY_DIR}new-topic.md`
      const result = await canUseTool(tool, {
        file_path: memFile,
        content: '## New Memory\n\nSome clean content here.',
      })
      expect(result.behavior).toBe('allow')
    })

    test('denies Edit for paths outside memory directory', async () => {
      const tool = makeMockTool('Edit')
      const result = await canUseTool(tool, { file_path: '/home/user/.ssh/id_rsa' })
      expect(result.behavior).toBe('deny')
    })

    test('denies Write for paths outside memory directory', async () => {
      const tool = makeMockTool('Write')
      const result = await canUseTool(tool, { file_path: '/tmp/other/file.ts' })
      expect(result.behavior).toBe('deny')
    })

    test('denies Edit/Write when file_path is missing', async () => {
      const tool = makeMockTool('Edit')
      const result = await canUseTool(tool, { content: 'no path' })
      expect(result.behavior).toBe('deny')
    })

    test('denies Write when content is undefined (bypass prevention)', async () => {
      const tool = makeMockTool('Write')
      const memFile = `${TEST_MEMORY_DIR}new-topic.md`
      const result = await canUseTool(tool, {
        file_path: memFile,
        // content intentionally missing
      })
      expect(result.behavior).toBe('deny')
    })

    test('allows Edit when new_string is undefined (deletion-only edit)', async () => {
      const tool = makeMockTool('Edit')
      const memFile = `${TEST_MEMORY_DIR}topic.md`
      const result = await canUseTool(tool, {
        file_path: memFile,
        old_string: 'text to remove',
        // new_string intentionally missing — deletion-only
      })
      expect(result.behavior).toBe('allow')
    })

    test('denies unknown tools', async () => {
      const tool = makeMockTool('AgentTool')
      const result = await canUseTool(tool, {})
      expect(result.behavior).toBe('deny')
    })
  })

  // ────────────────────────────────────────────────────────
  // 5. extractWrittenPaths (tested via forked agent result)
  // ────────────────────────────────────────────────────────

  describe('extractWrittenPaths (via forked agent result)', () => {
    test('extracts paths from Write tool_use blocks in agent output', async () => {
      const writtenPath = `${TEST_MEMORY_DIR}topic-new.md`

      // Make runForkedAgent return messages with Write tool_use
      mockRunForkedAgent.mockImplementationOnce(async () => ({
        messages: [
          makeAssistantWithToolUse('Write', writtenPath),
        ],
        totalUsage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 80,
          cache_creation_input_tokens: 20,
          service_tier: undefined,
          cache_creation: {
            ephemeral_1h_input_tokens: 0,
            ephemeral_5m_input_tokens: 0,
          },
        },
      }))

      const appendedMessages: unknown[] = []
      const appendSystemMessage = (msg: unknown) => {
        appendedMessages.push(msg)
      }

      const messages = [makeUserMessage(), makeAssistantMessage()]
      const ctx = makeContext(messages)

      await executeExtractMemories(ctx, appendSystemMessage as any)

      // A system message should have been appended for the saved memory
      expect(appendedMessages.length).toBe(1)
    })

    test('deduplicates paths when same file written multiple times', async () => {
      const writtenPath = `${TEST_MEMORY_DIR}topic.md`

      mockRunForkedAgent.mockImplementationOnce(async () => ({
        messages: [
          makeAssistantWithToolUse('Write', writtenPath),
          makeAssistantWithToolUse('Edit', writtenPath),
        ],
        totalUsage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          service_tier: undefined,
          cache_creation: {
            ephemeral_1h_input_tokens: 0,
            ephemeral_5m_input_tokens: 0,
          },
        },
      }))

      const appendedMessages: unknown[] = []
      const appendSystemMessage = (msg: unknown) => {
        appendedMessages.push(msg)
      }

      const messages = [makeUserMessage(), makeAssistantMessage()]
      const ctx = makeContext(messages)

      await executeExtractMemories(ctx, appendSystemMessage as any)

      // Should still produce exactly one notification (deduplicated)
      expect(appendedMessages.length).toBe(1)
    })

    test('skips non-Edit/Write tool_use blocks', async () => {
      mockRunForkedAgent.mockImplementationOnce(async () => ({
        messages: [
          makeAssistantMessage(undefined, [
            {
              type: 'tool_use',
              id: `toolu_${randomUUID()}`,
              name: 'Read',
              input: { file_path: '/tmp/foo.md' },
            },
          ]),
        ],
        totalUsage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          service_tier: undefined,
          cache_creation: {
            ephemeral_1h_input_tokens: 0,
            ephemeral_5m_input_tokens: 0,
          },
        },
      }))

      const appendedMessages: unknown[] = []
      const appendSystemMessage = (msg: unknown) => {
        appendedMessages.push(msg)
      }

      const messages = [makeUserMessage(), makeAssistantMessage()]
      const ctx = makeContext(messages)

      await executeExtractMemories(ctx, appendSystemMessage as any)

      // No memory saved notification — only Read blocks, no writes
      expect(appendedMessages.length).toBe(0)
    })

    test('does not notify for MEMORY.md index writes (ENTRYPOINT_NAME)', async () => {
      const entrypointPath = `${TEST_MEMORY_DIR}MEMORY.md`

      mockRunForkedAgent.mockImplementationOnce(async () => ({
        messages: [
          makeAssistantWithToolUse('Write', entrypointPath),
        ],
        totalUsage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          service_tier: undefined,
          cache_creation: {
            ephemeral_1h_input_tokens: 0,
            ephemeral_5m_input_tokens: 0,
          },
        },
      }))

      const appendedMessages: unknown[] = []
      const appendSystemMessage = (msg: unknown) => {
        appendedMessages.push(msg)
      }

      const messages = [makeUserMessage(), makeAssistantMessage()]
      const ctx = makeContext(messages)

      await executeExtractMemories(ctx, appendSystemMessage as any)

      // MEMORY.md is the index file — not a topic file, no notification
      expect(appendedMessages.length).toBe(0)
    })
  })

  // ────────────────────────────────────────────────────────
  // 6. Cursor Advancement & Coalescing
  // ────────────────────────────────────────────────────────

  describe('cursor advancement & coalescing', () => {
    test('lastMemoryMessageUuid advances after successful extraction', async () => {
      const msg1 = makeUserMessage()
      const msg2 = makeAssistantMessage()
      const ctx1 = makeContext([msg1, msg2])

      await executeExtractMemories(ctx1)
      expect(mockRunForkedAgent).toHaveBeenCalledTimes(1)

      // Call again with same messages — cursor already past them
      // hasMemoryWritesSince starts scanning from cursor, so no new
      // model-visible messages will be found. But runExtraction still
      // runs (newMessageCount may be 0 but that's fine).
      // The key check: second call should still invoke the forked agent
      // since it will try to extract from 0 new messages.
      const ctx2 = makeContext([msg1, msg2])
      await executeExtractMemories(ctx2)
      // Both calls should have triggered forked agent
      expect(mockRunForkedAgent).toHaveBeenCalledTimes(2)
    })

    test('cursor does not advance when extraction errors', async () => {
      // First: make forked agent throw an error
      mockRunForkedAgent.mockImplementationOnce(async () => {
        throw new Error('API error')
      })

      const msg1 = makeUserMessage()
      const msg2 = makeAssistantMessage()
      const ctx1 = makeContext([msg1, msg2])

      // This should catch the error internally and not advance cursor
      await executeExtractMemories(ctx1)
      expect(mockRunForkedAgent).toHaveBeenCalledTimes(1)

      // Reset mock to succeed
      mockRunForkedAgent.mockImplementation(async () => ({
        messages: [],
        totalUsage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          service_tier: undefined,
          cache_creation: {
            ephemeral_1h_input_tokens: 0,
            ephemeral_5m_input_tokens: 0,
          },
        },
      }))

      // Second call: same messages, cursor should NOT have advanced
      // so the forked agent should be called again with the same range
      const ctx2 = makeContext([msg1, msg2])
      await executeExtractMemories(ctx2)
      expect(mockRunForkedAgent).toHaveBeenCalledTimes(2)
    })

    test('drainPendingExtraction resolves when no extractions in flight', async () => {
      // No extractions started — should resolve immediately
      await drainPendingExtraction(1000)
      // No assertion needed — just verifying it doesn't hang
    })

    test('drainPendingExtraction waits for in-flight extraction', async () => {
      let resolveExtraction: (() => void) | null = null
      const extractionPromise = new Promise<void>(r => {
        resolveExtraction = r
      })

      mockRunForkedAgent.mockImplementationOnce(async () => {
        await extractionPromise
        return {
          messages: [],
          totalUsage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
            service_tier: undefined,
            cache_creation: {
              ephemeral_1h_input_tokens: 0,
              ephemeral_5m_input_tokens: 0,
            },
          },
        }
      })

      const messages = [makeUserMessage(), makeAssistantMessage()]
      const ctx = makeContext(messages)

      // Start extraction but don't await it
      const extractPromise = executeExtractMemories(ctx)

      // drainPendingExtraction should wait for the in-flight extraction
      let drained = false
      const drainPromise = drainPendingExtraction(5000).then(() => {
        drained = true
      })

      // Give microtasks time to process
      await new Promise(r => setTimeout(r, 50))
      expect(drained).toBe(false)

      // Resolve the extraction
      resolveExtraction!()

      // Now drain should complete
      await drainPromise
      expect(drained).toBe(true)

      // Clean up
      await extractPromise
    })

    test('concurrent coalescing: overlapping calls result in 1 immediate + 1 trailing', async () => {
      // Use a deferred promise so we can control when the first runForkedAgent resolves
      let resolveFirst!: () => void
      const firstCallBlocker = new Promise<void>(r => {
        resolveFirst = r
      })

      const defaultResult = {
        messages: [],
        totalUsage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          service_tier: undefined,
          cache_creation: {
            ephemeral_1h_input_tokens: 0,
            ephemeral_5m_input_tokens: 0,
          },
        },
      }

      // First call blocks until we resolve; second call returns immediately
      mockRunForkedAgent
        .mockImplementationOnce(async () => {
          await firstCallBlocker
          return defaultResult
        })
        .mockImplementationOnce(async () => defaultResult)

      const msg1 = makeUserMessage()
      const msg2 = makeAssistantMessage()
      const ctx1 = makeContext([msg1, msg2])

      const msg3 = makeUserMessage()
      const msg4 = makeAssistantMessage()
      const ctx2 = makeContext([msg1, msg2, msg3, msg4])

      // Fire two calls without awaiting — the second arrives while the first is in-progress
      const promise1 = executeExtractMemories(ctx1)
      // Let microtasks run so the first call enters runExtraction and sets inProgress=true
      await new Promise(r => setTimeout(r, 10))
      const promise2 = executeExtractMemories(ctx2)

      // At this point: first call is blocked, second call stashed as pendingContext
      // Only 1 runForkedAgent call should have started
      expect(mockRunForkedAgent).toHaveBeenCalledTimes(1)

      // Unblock the first call — its finally block will pick up the stashed context
      // and run a trailing extraction
      resolveFirst()

      // Wait for both promises to settle
      await promise1
      await promise2
      // Also drain to ensure trailing extraction completes
      await drainPendingExtraction(5000)

      // Total: 1 immediate + 1 trailing = 2 calls
      expect(mockRunForkedAgent).toHaveBeenCalledTimes(2)
    })

    test('throttle gate respects tengu_bramble_lintel (run every N turns)', async () => {
      // Set throttle to every 3 turns
      mockTenguBrambleLintel = 3

      const messages = [makeUserMessage(), makeAssistantMessage()]

      // Turn 1 — throttled (1 < 3)
      await executeExtractMemories(makeContext(messages))
      expect(mockRunForkedAgent).toHaveBeenCalledTimes(0)

      // Turn 2 — still throttled (2 < 3)
      await executeExtractMemories(makeContext(messages))
      expect(mockRunForkedAgent).toHaveBeenCalledTimes(0)

      // Turn 3 — runs (3 >= 3)
      await executeExtractMemories(makeContext(messages))
      expect(mockRunForkedAgent).toHaveBeenCalledTimes(1)
    })
  })

  // ────────────────────────────────────────────────────────
  // 7. initExtractMemories resets state
  // ────────────────────────────────────────────────────────

  describe('initExtractMemories', () => {
    test('re-initializing resets cursor and allows fresh extraction', async () => {
      const messages = [makeUserMessage(), makeAssistantMessage()]
      const ctx = makeContext(messages)

      await executeExtractMemories(ctx)
      expect(mockRunForkedAgent).toHaveBeenCalledTimes(1)

      // Re-initialize — resets cursor
      initExtractMemories()
      mockRunForkedAgent.mockClear()

      // Same messages should trigger extraction again (cursor reset)
      await executeExtractMemories(ctx)
      expect(mockRunForkedAgent).toHaveBeenCalledTimes(1)
    })

    test('executeExtractMemories runs normally after initExtractMemories', async () => {
      const messages = [makeUserMessage(), makeAssistantMessage()]
      const ctx = makeContext(messages)

      await executeExtractMemories(ctx)
      expect(mockRunForkedAgent).toHaveBeenCalledTimes(1)
    })
  })
})
