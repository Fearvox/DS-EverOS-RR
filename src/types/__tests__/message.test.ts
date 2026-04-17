import { describe, test, expect } from 'bun:test'
import type {
  AssistantMessage,
  UserMessage,
  SystemMessage,
  GroupedToolUseMessage,
  CollapsedReadSearchGroup,
  RenderableMessage,
  NormalizedAssistantMessage,
  NormalizedUserMessage,
} from '../message.js'
import { randomUUID } from 'crypto'

// Helper: create a base UUID for tests
const uuid = () => randomUUID()

describe('message types — runtime shape validation', () => {
  test('AssistantMessage discriminant is "assistant"', () => {
    const msg: AssistantMessage = {
      type: 'assistant',
      uuid: uuid(),
    }
    expect(msg.type).toBe('assistant')
  })

  test('UserMessage discriminant is "user"', () => {
    const msg: UserMessage = {
      type: 'user',
      uuid: uuid(),
    }
    expect(msg.type).toBe('user')
  })

  test('SystemMessage discriminant is "system"', () => {
    const msg: SystemMessage = {
      type: 'system',
      uuid: uuid(),
    }
    expect(msg.type).toBe('system')
  })

  test('GroupedToolUseMessage has required toolName and messages fields', () => {
    const inner: NormalizedAssistantMessage = { type: 'assistant', uuid: uuid() }
    const result: NormalizedUserMessage = { type: 'user', uuid: uuid() }
    const msg: GroupedToolUseMessage = {
      type: 'grouped_tool_use',
      uuid: uuid(),
      toolName: 'BashTool',
      messages: [inner],
      results: [result],
      displayMessage: inner,
    }
    expect(msg.toolName).toBe('BashTool')
    expect(msg.messages).toHaveLength(1)
  })

  test('RenderableMessage union accepts AssistantMessage', () => {
    const msg: AssistantMessage = { type: 'assistant', uuid: uuid() }
    const renderable: RenderableMessage = msg
    expect(renderable.type).toBe('assistant')
  })

  test('CollapsedReadSearchGroup has correct count fields', () => {
    const inner: AssistantMessage = { type: 'assistant', uuid: uuid() }
    const group: CollapsedReadSearchGroup = {
      type: 'collapsed_read_search',
      uuid: uuid(),
      searchCount: 2,
      readCount: 3,
      listCount: 0,
      replCount: 0,
      memorySearchCount: 0,
      memoryReadCount: 0,
      memoryWriteCount: 0,
      readFilePaths: ['src/foo.ts'],
      searchArgs: ['pattern'],
      messages: [inner],
      displayMessage: inner,
    }
    expect(group.searchCount).toBe(2)
    expect(group.readFilePaths).toEqual(['src/foo.ts'])
  })

  test('Message base fields are present on all subtypes', () => {
    const msg: AssistantMessage = {
      type: 'assistant',
      uuid: uuid(),
      isMeta: true,
      isCompactSummary: false,
    }
    expect(msg.isMeta).toBe(true)
    expect(msg.isCompactSummary).toBe(false)
  })
})
