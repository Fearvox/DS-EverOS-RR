/**
 * Shared ToolUseContext test factory for all tool integration tests.
 *
 * Creates a minimal valid ToolUseContext with sensible defaults for testing.
 * All tool tests in this phase should use this factory instead of constructing
 * ToolUseContext manually.
 */
import type { ToolUseContext } from 'src/Tool.js'
import { getEmptyToolPermissionContext } from 'src/Tool.js'
import type { AppState } from 'src/state/AppState.js'
import { createFileStateCacheWithSizeLimit } from 'src/utils/fileStateCache.js'

export function createTestToolUseContext(
  overrides?: Partial<ToolUseContext>,
): ToolUseContext {
  const abortController = new AbortController()
  const messages: ToolUseContext['messages'] = []

  const appState = {
    toolPermissionContext: getEmptyToolPermissionContext(),
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
    abortController,
    readFileState: createFileStateCacheWithSizeLimit(100),
    getAppState: () => appState,
    setAppState: () => {},
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    messages,
    ...overrides,
  } as ToolUseContext
}
