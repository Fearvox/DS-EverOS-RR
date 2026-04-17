// @ts-nocheck — integration test against api/relay with mocked upstream fetch
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'

// Mock VercelRequest/Response
class MockResponse {
  headers: Record<string, string> = {}
  statusCode = 200
  chunks: string[] = []
  ended = false
  jsonBody: unknown = null
  setHeader(k: string, v: string) { this.headers[k.toLowerCase()] = v; return this }
  status(code: number) { this.statusCode = code; return this }
  json(obj: unknown) { this.jsonBody = obj; this.ended = true; return this }
  write(c: string) { this.chunks.push(c); return true }
  end() { this.ended = true }
  flushHeaders() {}
}

// Fake ReadableStream that yields OpenAI SSE chunks
function makeUpstreamStream(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  let i = 0
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close()
        return
      }
      controller.enqueue(enc.encode(chunks[i]))
      i++
    },
  })
}

describe('relay streaming translation (08.3)', () => {
  let originalFetch: typeof globalThis.fetch
  let originalKey: string | undefined
  beforeAll(() => {
    originalFetch = globalThis.fetch
    originalKey = process.env.MINIMAX_API_KEY
    process.env.MINIMAX_API_KEY = 'test-key'
  })
  afterAll(() => {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.MINIMAX_API_KEY
    else process.env.MINIMAX_API_KEY = originalKey
  })

  it('translates OpenAI SSE chunks into Anthropic event stream', async () => {
    const openaiChunks = [
      'data: {"choices":[{"delta":{"content":"Hel"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":3}}\n\n',
      'data: [DONE]\n\n',
    ]
    globalThis.fetch = mock(async () => ({
      ok: true,
      status: 200,
      body: makeUpstreamStream(openaiChunks),
      text: async () => '',
    })) as any

    // Fresh import so handler uses our mocked fetch
    delete require.cache?.[require.resolve('../api/relay/index.ts')]
    const mod = await import(`../api/relay/index.ts?t=${Date.now()}`)
    const handler = mod.default

    const req: any = {
      method: 'POST',
      query: {},
      body: {
        model: 'minimax-m2',
        stream: true,
        messages: [{ role: 'user', content: 'Hi' }],
      },
    }
    const res = new MockResponse()
    await handler(req, res)

    const out = res.chunks.join('')
    expect(res.headers['content-type']).toBe('text/event-stream')
    expect(res.statusCode).toBe(200)
    expect(res.ended).toBe(true)

    // Verify event ordering
    const events = out.split('\n\n').filter(Boolean).map(b => {
      const [evLine, dataLine] = b.split('\n')
      return { event: evLine.replace('event: ', ''), data: JSON.parse(dataLine.replace('data: ', '')) }
    })
    const names = events.map(e => e.event)
    expect(names[0]).toBe('message_start')
    expect(names[1]).toBe('content_block_start')
    expect(names).toContain('content_block_delta')
    expect(names[names.length - 3]).toBe('content_block_stop')
    expect(names[names.length - 2]).toBe('message_delta')
    expect(names[names.length - 1]).toBe('message_stop')

    // Concatenated text should reconstruct "Hello world"
    const text = events
      .filter(e => e.event === 'content_block_delta')
      .map(e => e.data.delta.text)
      .join('')
    expect(text).toBe('Hello world')

    // Usage propagated
    const msgDelta = events.find(e => e.event === 'message_delta')!
    expect(msgDelta.data.usage.input_tokens).toBe(5)
    expect(msgDelta.data.usage.output_tokens).toBe(3)
    expect(msgDelta.data.delta.stop_reason).toBe('end_turn')
  })

  it('maps finish_reason=length to stop_reason=max_tokens', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"long..."},"finish_reason":"length"}],"usage":{"prompt_tokens":10,"completion_tokens":100}}\n\n',
      'data: [DONE]\n\n',
    ]
    globalThis.fetch = mock(async () => ({
      ok: true,
      status: 200,
      body: makeUpstreamStream(chunks),
      text: async () => '',
    })) as any

    const mod = await import(`../api/relay/index.ts?t=${Date.now() + 1}`)
    const handler = mod.default
    const req: any = {
      method: 'POST', query: {},
      body: { model: 'minimax-m2', stream: true, messages: [] },
    }
    const res = new MockResponse()
    await handler(req, res)
    const out = res.chunks.join('')
    const msgDelta = out.split('\n\n')
      .filter(b => b.includes('event: message_delta'))[0]
    expect(msgDelta).toContain('"stop_reason":"max_tokens"')
  })

  it('falls back to non-streaming transform when stream flag absent', async () => {
    globalThis.fetch = mock(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: 'resp_1',
        choices: [{ message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 3, completion_tokens: 1 },
      }),
    })) as any

    const mod = await import(`../api/relay/index.ts?t=${Date.now() + 2}`)
    const handler = mod.default
    const req: any = {
      method: 'POST', query: {},
      body: { model: 'minimax-m2', messages: [] },
    }
    const res = new MockResponse()
    await handler(req, res)
    // Non-streaming path: jsonBody should be populated, no SSE chunks
    expect(res.chunks.length).toBe(0)
    expect((res.jsonBody as any)?.type).toBe('message')
    expect((res.jsonBody as any)?.content?.[0]?.text).toBe('hello')
  })
})
