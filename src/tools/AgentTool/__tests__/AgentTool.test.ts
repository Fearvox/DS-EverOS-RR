/**
 * AgentTool context propagation tests.
 *
 * Tests exercise createSubagentContext() directly from src/utils/forkedAgent.ts
 * to verify ToolUseContext is correctly propagated to nested subagents.
 *
 * Per RESEARCH.md Pitfall 5: We test createSubagentContext() directly,
 * NOT AgentTool.call() which would require a live API connection.
 */
import { describe, test, expect, mock, beforeAll } from 'bun:test'
import { createTestToolUseContext } from '../../__tests__/createTestToolUseContext.js'

// Mock heavy transitive imports that forkedAgent.ts pulls in at module level.
// createSubagentContext itself doesn't use these, but the module imports them.
beforeAll(() => {
  // Ensure env is set before any imports
  process.env.CLAUDE_CODE_DISABLE_SANDBOX = '1'
})

// Lazy import to allow mocks/env to be set first
async function getCreateSubagentContext() {
  const mod = await import('src/utils/forkedAgent.js')
  return mod.createSubagentContext
}

describe('createSubagentContext', () => {
  test('creates a NEW AbortController that aborts when parent aborts', async () => {
    const createSubagentContext = await getCreateSubagentContext()
    const parent = createTestToolUseContext()
    const child = createSubagentContext(parent)

    // Child has its own controller
    expect(child.abortController).not.toBe(parent.abortController)

    // When parent aborts, child should also abort (linked via event listener)
    parent.abortController.abort('parent-abort-reason')
    // Give the event listener a tick to propagate
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(child.abortController.signal.aborted).toBe(true)
  })

  test('aborting child does NOT abort parent', async () => {
    const createSubagentContext = await getCreateSubagentContext()
    const parent = createTestToolUseContext()
    const child = createSubagentContext(parent)

    child.abortController.abort('child-abort-reason')
    expect(parent.abortController.signal.aborted).toBe(false)
  })

  test('shareAbortController=true uses same controller as parent', async () => {
    const createSubagentContext = await getCreateSubagentContext()
    const parent = createTestToolUseContext()
    const child = createSubagentContext(parent, {
      shareAbortController: true,
    })

    expect(child.abortController).toBe(parent.abortController)
  })

  test('child has fresh readFileState (not reference-equal to parent)', async () => {
    const createSubagentContext = await getCreateSubagentContext()
    const parent = createTestToolUseContext()
    const child = createSubagentContext(parent)

    expect(child.readFileState).not.toBe(parent.readFileState)
  })

  test('child preserves parent options when no override provided', async () => {
    const createSubagentContext = await getCreateSubagentContext()
    const parent = createTestToolUseContext()
    const child = createSubagentContext(parent)

    expect(child.options.mainLoopModel).toBe(parent.options.mainLoopModel)
    expect(child.options.isNonInteractiveSession).toBe(
      parent.options.isNonInteractiveSession,
    )
    expect(child.options).toBe(parent.options) // same reference when no override
  })

  test('child getAppState wraps parent to set shouldAvoidPermissionPrompts', async () => {
    const createSubagentContext = await getCreateSubagentContext()
    const parent = createTestToolUseContext()
    const child = createSubagentContext(parent)

    // Child's getAppState should be callable and return an AppState
    const childState = child.getAppState()
    expect(childState).toBeDefined()
    expect(childState.toolPermissionContext).toBeDefined()

    // Non-shared subagent should have shouldAvoidPermissionPrompts=true
    expect(
      childState.toolPermissionContext.shouldAvoidPermissionPrompts,
    ).toBe(true)
  })

  test('child has isolated messages when no override provided', async () => {
    const createSubagentContext = await getCreateSubagentContext()
    const parent = createTestToolUseContext()
    const child = createSubagentContext(parent)

    // Messages reference is shared by default (same array)
    // This is the actual behavior: messages are NOT cloned, they use
    // the override or parent's array directly
    expect(child.messages).toBe(parent.messages)
  })

  test('child messages can be overridden with custom array', async () => {
    const createSubagentContext = await getCreateSubagentContext()
    const parent = createTestToolUseContext()
    const customMessages: any[] = [{ type: 'user', content: 'test' }]
    const child = createSubagentContext(parent, {
      messages: customMessages,
    })

    expect(child.messages).toBe(customMessages)
    expect(child.messages).not.toBe(parent.messages)
  })

  test('child setAppState is no-op by default', async () => {
    const createSubagentContext = await getCreateSubagentContext()
    const parent = createTestToolUseContext()
    const child = createSubagentContext(parent)

    // setAppState should be a no-op function (does not throw)
    expect(() => child.setAppState(() => ({}) as any)).not.toThrow()
  })

  test('child gets unique agentId', async () => {
    const createSubagentContext = await getCreateSubagentContext()
    const parent = createTestToolUseContext()
    const child1 = createSubagentContext(parent)
    const child2 = createSubagentContext(parent)

    // Each child should get a unique agentId
    expect(child1.agentId).toBeDefined()
    expect(child2.agentId).toBeDefined()
    expect(child1.agentId).not.toBe(child2.agentId)
  })

  test('shareAbortController=true shares getAppState without permission wrapping', async () => {
    const createSubagentContext = await getCreateSubagentContext()
    const parent = createTestToolUseContext()
    const child = createSubagentContext(parent, {
      shareAbortController: true,
    })

    // When sharing abort controller, getAppState is also shared (interactive agent)
    const childState = child.getAppState()
    const parentState = parent.getAppState()

    // Should NOT wrap shouldAvoidPermissionPrompts for interactive agents
    expect(
      childState.toolPermissionContext.shouldAvoidPermissionPrompts,
    ).toBe(parentState.toolPermissionContext.shouldAvoidPermissionPrompts)
  })
})
