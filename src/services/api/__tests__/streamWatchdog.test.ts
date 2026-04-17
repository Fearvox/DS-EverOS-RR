import { describe, test, expect, afterEach } from 'bun:test'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import { safeParseStreamEvent } from '../streamEventSchema.js'

// ---------------------------------------------------------------------------
// Watchdog env-var logic tests
// ---------------------------------------------------------------------------
// These test the EXACT expression used in claude.ts line ~1878:
//   const streamWatchdogEnabled = !isEnvTruthy(process.env.CLAUDE_DISABLE_STREAM_WATCHDOG)
//
// We test the expression inline rather than importing from claude.ts because
// the watchdog variables are local to queryModel() and not exported.
// ---------------------------------------------------------------------------

describe('stream watchdog env var', () => {
  const savedEnv = { ...process.env }
  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) {
        delete process.env[key]
      }
    }
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = value
      }
    }
  })

  test('watchdog enabled by default (CLAUDE_DISABLE_STREAM_WATCHDOG not set)', () => {
    delete process.env.CLAUDE_DISABLE_STREAM_WATCHDOG
    const enabled = !isEnvTruthy(process.env.CLAUDE_DISABLE_STREAM_WATCHDOG)
    expect(enabled).toBe(true)
  })

  test('watchdog disabled when CLAUDE_DISABLE_STREAM_WATCHDOG=1', () => {
    process.env.CLAUDE_DISABLE_STREAM_WATCHDOG = '1'
    const enabled = !isEnvTruthy(process.env.CLAUDE_DISABLE_STREAM_WATCHDOG)
    expect(enabled).toBe(false)
  })

  test('watchdog disabled when CLAUDE_DISABLE_STREAM_WATCHDOG=true', () => {
    process.env.CLAUDE_DISABLE_STREAM_WATCHDOG = 'true'
    const enabled = !isEnvTruthy(process.env.CLAUDE_DISABLE_STREAM_WATCHDOG)
    expect(enabled).toBe(false)
  })

  test('watchdog stays enabled for non-truthy values', () => {
    process.env.CLAUDE_DISABLE_STREAM_WATCHDOG = '0'
    const enabled = !isEnvTruthy(process.env.CLAUDE_DISABLE_STREAM_WATCHDOG)
    expect(enabled).toBe(true)
  })

  test('CLAUDE_STREAM_IDLE_TIMEOUT_MS configures timeout', () => {
    process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS = '30000'
    const timeout =
      parseInt(process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS || '', 10) || 90_000
    expect(timeout).toBe(30000)
  })

  test('defaults to 90s when CLAUDE_STREAM_IDLE_TIMEOUT_MS not set', () => {
    delete process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS
    const timeout =
      parseInt(process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS || '', 10) || 90_000
    expect(timeout).toBe(90000)
  })

  test('defaults to 90s when CLAUDE_STREAM_IDLE_TIMEOUT_MS is garbage', () => {
    process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS = 'not_a_number'
    const timeout =
      parseInt(process.env.CLAUDE_STREAM_IDLE_TIMEOUT_MS || '', 10) || 90_000
    expect(timeout).toBe(90000)
  })
})

// ---------------------------------------------------------------------------
// Mock stream iterator patterns
// ---------------------------------------------------------------------------
// These test the async generator patterns used to simulate streaming in
// integration tests. The patterns themselves are reusable test utilities.
// ---------------------------------------------------------------------------

describe('mock stream patterns', () => {
  test('createMockStream yields all events in order', async () => {
    async function* createMockStream(
      events: Array<{ type: string }>,
    ): AsyncGenerator<{ type: string }> {
      for (const event of events) {
        yield event
      }
    }

    const events = [
      { type: 'message_start' },
      { type: 'content_block_start' },
      { type: 'content_block_delta' },
      { type: 'content_block_stop' },
      { type: 'message_delta' },
      { type: 'message_stop' },
    ]
    const received: Array<{ type: string }> = []
    for await (const event of createMockStream(events)) {
      received.push(event)
    }
    expect(received).toHaveLength(6)
    expect(received.map((e) => e.type)).toEqual(events.map((e) => e.type))
  })

  test('createFailingStream throws ECONNRESET mid-stream', async () => {
    async function* createFailingStream(
      events: Array<{ type: string }>,
      error: Error,
    ): AsyncGenerator<{ type: string }> {
      for (const event of events) {
        yield event
      }
      throw error
    }

    const received: Array<{ type: string }> = []
    const connError = new Error('Connection reset')
    ;(connError as NodeJS.ErrnoException).code = 'ECONNRESET'

    await expect(async () => {
      for await (const event of createFailingStream(
        [{ type: 'message_start' }],
        connError,
      )) {
        received.push(event)
      }
    }).toThrow('Connection reset')
    expect(received).toHaveLength(1)
  })

  test('createStallingStream simulates idle timeout pattern', async () => {
    async function* createStallingStream(
      events: Array<{ type: string }>,
      stallAfter: number,
      stallMs: number,
    ): AsyncGenerator<{ type: string }> {
      for (let i = 0; i < events.length; i++) {
        if (i === stallAfter) {
          await new Promise((resolve) => setTimeout(resolve, stallMs))
        }
        yield events[i]
      }
    }

    const events = [
      { type: 'message_start' },
      { type: 'content_block_start' },
      { type: 'message_stop' },
    ]
    const start = Date.now()
    const received: Array<{ type: string }> = []
    for await (const event of createStallingStream(events, 1, 50)) {
      received.push(event)
    }
    const elapsed = Date.now() - start
    expect(received).toHaveLength(3)
    // Stall of 50ms should be measurable
    expect(elapsed).toBeGreaterThanOrEqual(40)
  })
})

// ---------------------------------------------------------------------------
// Streaming loop validation pattern tests
// ---------------------------------------------------------------------------
// Tests that safeParseStreamEvent correctly validates/rejects events as they
// would flow through the streaming loop in claude.ts.
// ---------------------------------------------------------------------------

describe('streaming loop validation pattern', () => {
  test('known events pass validation (simulate loop entry)', () => {
    const knownEvents = [
      {
        type: 'message_start',
        message: {
          id: 'msg_1',
          type: 'message',
          role: 'assistant',
          content: [],
          model: 'claude-sonnet-4-5-20250514',
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 5 },
      },
      { type: 'message_stop' },
    ]

    for (const event of knownEvents) {
      const validated = safeParseStreamEvent(event)
      expect(validated).not.toBeNull()
      expect(validated!.type).toBe(event.type)
    }
  })

  test('unknown event types return null (would be skipped in loop)', () => {
    const unknownEvents = [
      { type: 'future_event_type', data: {} },
      { type: 'ping' },
      { type: 'server_side_only_event', payload: 'irrelevant' },
    ]

    for (const event of unknownEvents) {
      const validated = safeParseStreamEvent(event)
      expect(validated).toBeNull()
    }
  })
})
