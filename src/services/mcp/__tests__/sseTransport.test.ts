/**
 * MCP SSE transport integration tests.
 *
 * Proves that SSEClientTransport + Client work under Bun runtime:
 * - SSEClientTransport import and instantiation
 * - tools/list JSON-RPC round-trip over SSE
 * - tools/call JSON-RPC round-trip over SSE
 * - Error handling for unreachable URLs
 *
 * NOTE: MCP SDK v1.29.0 deprecates SSEClientTransport in favor of
 * StreamableHTTPClientTransport. However, SSEClientTransport is still
 * exported and used by the CCB codebase for backward compatibility with
 * existing MCP servers that use the SSE protocol.
 *
 * Uses an in-process Bun.serve() SSE server as test fixture that implements
 * the MCP SSE protocol:
 * - GET /sse: Returns text/event-stream with 'endpoint' event
 * - POST /message: Accepts JSON-RPC, sends response as SSE 'message' event
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import {
  ListToolsResultSchema,
  CallToolResultSchema,
} from '@modelcontextprotocol/sdk/types.js'

// ---- In-process SSE server fixture ----

// The MCP SSE protocol:
// 1. Client opens GET /sse -> server returns text/event-stream
// 2. Server sends "event: endpoint\ndata: <POST URL>\n\n" on the stream
// 3. Client POSTs JSON-RPC requests to the POST URL
// 4. Server sends "event: message\ndata: <JSON-RPC response>\n\n" on SSE stream
// 5. POST response is 202 Accepted (body discarded by client)

type SSEController = ReadableStreamDefaultController<Uint8Array>

let server: ReturnType<typeof Bun.serve>
let serverUrl: string
// Track active SSE connections so POST handler can write responses
let activeControllers: Set<SSEController>

function handleJsonRpc(body: any): any {
  if (body.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id: body.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'sse-test-server', version: '1.0.0' },
      },
    }
  }
  if (body.method === 'notifications/initialized') {
    return null // No response for notifications
  }
  if (body.method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id: body.id,
      result: {
        tools: [
          {
            name: 'sse_test_tool',
            description: 'SSE test tool that echoes input',
            inputSchema: {
              type: 'object',
              properties: { input: { type: 'string' } },
              required: ['input'],
            },
          },
        ],
      },
    }
  }
  if (body.method === 'tools/call') {
    const args = body.params?.arguments || {}
    return {
      jsonrpc: '2.0',
      id: body.id,
      result: {
        content: [
          { type: 'text', text: 'sse-echo: ' + (args.input || 'none') },
        ],
      },
    }
  }
  return {
    jsonrpc: '2.0',
    id: body.id,
    error: { code: -32601, message: 'Method not found' },
  }
}

function sseEvent(eventType: string, data: string): string {
  return `event: ${eventType}\ndata: ${data}\n\n`
}

beforeAll(() => {
  activeControllers = new Set()

  server = Bun.serve({
    port: 0, // random available port
    fetch(req) {
      const url = new URL(req.url)

      if (url.pathname === '/sse' && req.method === 'GET') {
        // SSE endpoint: create stream, send endpoint event, keep alive
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            activeControllers.add(controller)

            // Send the endpoint event telling client where to POST
            const endpointUrl = `http://localhost:${server.port}/message`
            const msg = sseEvent('endpoint', endpointUrl)
            controller.enqueue(new TextEncoder().encode(msg))
          },
          cancel() {
            // Client disconnected -- clean up
            // Controller already closed by the time cancel is called
          },
        })

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
          },
        })
      }

      if (url.pathname === '/message' && req.method === 'POST') {
        return (async () => {
          const body = await req.json()
          const response = handleJsonRpc(body)

          if (response !== null) {
            // Send response as SSE message event on ALL active streams
            const msg = sseEvent('message', JSON.stringify(response))
            const encoded = new TextEncoder().encode(msg)
            for (const controller of activeControllers) {
              try {
                controller.enqueue(encoded)
              } catch {
                // Controller may be closed; remove it
                activeControllers.delete(controller)
              }
            }
          }

          return new Response(null, { status: 202 })
        })()
      }

      return new Response('Not found', { status: 404 })
    },
  })

  serverUrl = `http://localhost:${server.port}/sse`
})

afterAll(() => {
  // Close all active SSE streams
  for (const controller of activeControllers) {
    try {
      controller.close()
    } catch {
      // ignore
    }
  }
  activeControllers.clear()
  server?.stop()
})

describe('MCP SSE transport under Bun', () => {
  test('SSEClientTransport can be imported and instantiated', () => {
    // Verify the import worked and constructor accepts URL
    const transport = new SSEClientTransport(new URL(serverUrl))
    expect(transport).toBeDefined()
    expect(typeof transport.start).toBe('function')
    expect(typeof transport.close).toBe('function')
    expect(typeof transport.send).toBe('function')
  })

  test('tools/list returns tool definitions over SSE transport', async () => {
    const transport = new SSEClientTransport(new URL(serverUrl))
    const client = new Client(
      { name: 'test-sse-client', version: '1.0.0' },
      { capabilities: {} },
    )

    await client.connect(transport)

    const result = await client.request(
      { method: 'tools/list' },
      ListToolsResultSchema,
    )

    expect(result.tools).toBeArray()
    expect(result.tools.length).toBeGreaterThan(0)
    expect(result.tools[0].name).toBe('sse_test_tool')
    expect(result.tools[0].description).toBe(
      'SSE test tool that echoes input',
    )
    expect(result.tools[0].inputSchema).toBeDefined()

    await client.close()
  }, 15_000)

  test('tools/call round-trip returns expected result over SSE transport', async () => {
    const transport = new SSEClientTransport(new URL(serverUrl))
    const client = new Client(
      { name: 'test-sse-client', version: '1.0.0' },
      { capabilities: {} },
    )

    await client.connect(transport)

    const result = await client.request(
      {
        method: 'tools/call',
        params: {
          name: 'sse_test_tool',
          arguments: { input: 'hello' },
        },
      },
      CallToolResultSchema,
    )

    expect(result.content).toBeArray()
    expect(result.content.length).toBeGreaterThan(0)

    const textContent = result.content.find(
      (c: { type: string }) => c.type === 'text',
    ) as { type: string; text: string } | undefined
    expect(textContent).toBeDefined()
    expect(textContent!.text).toBe('sse-echo: hello')

    await client.close()
  }, 15_000)

  test('connection to unreachable URL fails with catchable error', async () => {
    // Port 1 is almost certainly not running an MCP server
    const transport = new SSEClientTransport(
      new URL('http://localhost:1/sse'),
    )
    const client = new Client(
      { name: 'test-sse-client', version: '1.0.0' },
      { capabilities: {} },
    )

    let threw = false
    try {
      await client.connect(transport)
    } catch (err) {
      threw = true
      expect(err).toBeDefined()
    }

    expect(threw).toBe(true)

    // Cleanup
    try {
      await client.close()
    } catch {
      // ignore
    }
  }, 15_000)
})
