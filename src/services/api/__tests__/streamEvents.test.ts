import { describe, test, expect } from 'bun:test'
import {
  streamEventSchema,
  parseStreamEvent,
  safeParseStreamEvent,
  type ParsedStreamEvent,
} from '../streamEventSchema.js'

describe('streamEventSchema', () => {
  describe('valid events parse correctly', () => {
    test('message_start event', () => {
      const raw = {
        type: 'message_start',
        message: {
          id: 'msg_abc123',
          type: 'message',
          role: 'assistant',
          content: [],
          model: 'claude-sonnet-4-5-20250514',
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      }
      const result = parseStreamEvent(raw)
      expect(result.type).toBe('message_start')
    })

    test('message_start with cache token fields', () => {
      const raw = {
        type: 'message_start',
        message: {
          id: 'msg_cache',
          type: 'message',
          role: 'assistant',
          content: [],
          model: 'claude-sonnet-4-5-20250514',
          usage: {
            input_tokens: 10,
            output_tokens: 0,
            cache_creation_input_tokens: 500,
            cache_read_input_tokens: 200,
          },
        },
      }
      const result = parseStreamEvent(raw)
      expect(result.type).toBe('message_start')
    })

    test('content_block_start with text block', () => {
      const raw = {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      }
      const result = parseStreamEvent(raw)
      expect(result.type).toBe('content_block_start')
      if (result.type === 'content_block_start') {
        expect(result.index).toBe(0)
      }
    })

    test('content_block_start with tool_use block', () => {
      const raw = {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'toolu_abc', name: 'BashTool', input: {} },
      }
      const result = parseStreamEvent(raw)
      expect(result.type).toBe('content_block_start')
    })

    test('content_block_start with thinking block', () => {
      const raw = {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '' },
      }
      const result = parseStreamEvent(raw)
      expect(result.type).toBe('content_block_start')
    })

    test('content_block_delta with text_delta', () => {
      const raw = {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello world' },
      }
      const result = parseStreamEvent(raw)
      expect(result.type).toBe('content_block_delta')
    })

    test('content_block_delta with input_json_delta', () => {
      const raw = {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"command":' },
      }
      const result = parseStreamEvent(raw)
      expect(result.type).toBe('content_block_delta')
    })

    test('content_block_delta with thinking_delta', () => {
      const raw = {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'Let me think...' },
      }
      const result = parseStreamEvent(raw)
      expect(result.type).toBe('content_block_delta')
    })

    test('content_block_delta with signature_delta', () => {
      const raw = {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'signature_delta', signature: 'sig_abc123' },
      }
      const result = parseStreamEvent(raw)
      expect(result.type).toBe('content_block_delta')
    })

    test('content_block_delta with citations_delta', () => {
      const raw = {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'citations_delta', citation: { start: 0, end: 10 } },
      }
      const result = parseStreamEvent(raw)
      expect(result.type).toBe('content_block_delta')
    })

    test('content_block_stop event', () => {
      const raw = { type: 'content_block_stop', index: 0 }
      const result = parseStreamEvent(raw)
      expect(result.type).toBe('content_block_stop')
      if (result.type === 'content_block_stop') {
        expect(result.index).toBe(0)
      }
    })

    test('message_delta event', () => {
      const raw = {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: 42 },
      }
      const result = parseStreamEvent(raw)
      expect(result.type).toBe('message_delta')
    })

    test('message_stop event', () => {
      const raw = { type: 'message_stop' }
      const result = parseStreamEvent(raw)
      expect(result.type).toBe('message_stop')
    })

    test('error event', () => {
      const raw = {
        type: 'error',
        error: { type: 'overloaded_error', message: 'Service overloaded' },
      }
      const result = parseStreamEvent(raw)
      expect(result.type).toBe('error')
    })
  })

  describe('passthrough preserves extra fields', () => {
    test('extra fields on message_start.message are preserved', () => {
      const raw = {
        type: 'message_start',
        message: {
          id: 'msg_pass',
          type: 'message',
          role: 'assistant',
          content: [],
          model: 'claude-opus-4-5-20250514',
          usage: { input_tokens: 5, output_tokens: 0 },
          extra_sdk_field: 'should survive passthrough',
        },
      }
      const result = parseStreamEvent(raw) as Extract<ParsedStreamEvent, { type: 'message_start' }>
      expect((result.message as Record<string, unknown>)['extra_sdk_field']).toBe(
        'should survive passthrough',
      )
    })

    test('extra fields on content_block_delta are preserved (research)', () => {
      const raw = {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'hi' },
        research: { some: 'data' },
      }
      const result = parseStreamEvent(raw)
      expect((result as Record<string, unknown>)['research']).toEqual({ some: 'data' })
    })

    test('extra fields on content_block.passthrough', () => {
      const raw = {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'server_tool_use', id: 'stu_1', name: 'advisor', input: {} },
      }
      const result = parseStreamEvent(raw) as Extract<
        ParsedStreamEvent,
        { type: 'content_block_start' }
      >
      expect((result.content_block as Record<string, unknown>)['name']).toBe('advisor')
    })
  })

  describe('invalid events are rejected', () => {
    test('completely unknown type throws ZodError', () => {
      const raw = { type: 'totally_unknown_event', data: {} }
      expect(() => parseStreamEvent(raw)).toThrow()
    })

    test('missing required field throws ZodError', () => {
      // content_block_delta missing required 'delta' field
      const raw = { type: 'content_block_delta', index: 0 }
      expect(() => parseStreamEvent(raw)).toThrow()
    })

    test('missing index on content_block_start throws ZodError', () => {
      const raw = {
        type: 'content_block_start',
        content_block: { type: 'text' },
      }
      expect(() => parseStreamEvent(raw)).toThrow()
    })

    test('null input throws ZodError', () => {
      expect(() => parseStreamEvent(null)).toThrow()
    })

    test('non-object input throws ZodError', () => {
      expect(() => parseStreamEvent('not an object')).toThrow()
    })

    test('missing message on message_start throws ZodError', () => {
      const raw = { type: 'message_start' }
      expect(() => parseStreamEvent(raw)).toThrow()
    })
  })

  describe('safeParseStreamEvent', () => {
    test('valid event returns parsed result', () => {
      const raw = { type: 'message_stop' }
      const result = safeParseStreamEvent(raw)
      expect(result).not.toBeNull()
      expect(result?.type).toBe('message_stop')
    })

    test('invalid event returns null instead of throwing', () => {
      const raw = { type: 'unknown_event' }
      const result = safeParseStreamEvent(raw)
      expect(result).toBeNull()
    })

    test('null input returns null instead of throwing', () => {
      const result = safeParseStreamEvent(null)
      expect(result).toBeNull()
    })
  })
})
