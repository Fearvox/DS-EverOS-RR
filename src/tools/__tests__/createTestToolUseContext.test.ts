import { describe, test, expect } from 'bun:test'
import { createTestToolUseContext } from './createTestToolUseContext.js'

describe('createTestToolUseContext', () => {
  test('returns object with all required ToolUseContext fields', () => {
    const ctx = createTestToolUseContext()

    // Core required fields
    expect(ctx.options).toBeDefined()
    expect(ctx.options.commands).toEqual([])
    expect(ctx.options.debug).toBe(false)
    expect(ctx.options.mainLoopModel).toBeTypeOf('string')
    expect(ctx.options.tools).toEqual([])
    expect(ctx.options.verbose).toBe(false)
    expect(ctx.options.thinkingConfig).toBeDefined()
    expect(ctx.options.mcpClients).toEqual([])
    expect(ctx.options.mcpResources).toEqual({})
    expect(ctx.options.isNonInteractiveSession).toBe(true)
    expect(ctx.options.agentDefinitions).toBeDefined()

    // Functions
    expect(ctx.abortController).toBeInstanceOf(AbortController)
    expect(ctx.readFileState).toBeDefined()
    expect(ctx.getAppState).toBeTypeOf('function')
    expect(ctx.setAppState).toBeTypeOf('function')
    expect(ctx.setInProgressToolUseIDs).toBeTypeOf('function')
    expect(ctx.setResponseLength).toBeTypeOf('function')
    expect(ctx.updateFileHistoryState).toBeTypeOf('function')
    expect(ctx.updateAttributionState).toBeTypeOf('function')
    expect(ctx.messages).toBeInstanceOf(Array)
  })

  test('overrides messages field when provided', () => {
    const customMessages = [{ type: 'user', content: 'test' }] as any[]
    const ctx = createTestToolUseContext({ messages: customMessages })

    expect(ctx.messages).toBe(customMessages)
    expect(ctx.messages).toHaveLength(1)
  })

  test('has a working abortController', () => {
    const ctx = createTestToolUseContext()

    expect(ctx.abortController.signal.aborted).toBe(false)
    ctx.abortController.abort()
    expect(ctx.abortController.signal.aborted).toBe(true)
  })

  test('readFileState supports get and set', () => {
    const ctx = createTestToolUseContext()

    expect(ctx.readFileState.get('/test/file.ts')).toBeUndefined()

    ctx.readFileState.set('/test/file.ts', {
      content: 'hello',
      timestamp: Date.now(),
      offset: undefined,
      limit: undefined,
    })

    const entry = ctx.readFileState.get('/test/file.ts')
    expect(entry).toBeDefined()
    expect(entry!.content).toBe('hello')
  })
})
