/**
 * MCP stdio transport integration tests.
 *
 * Proves that StdioClientTransport + Client work under Bun runtime:
 * - child_process.spawn compatibility
 * - tools/list JSON-RPC round-trip
 * - tools/call JSON-RPC round-trip (ROADMAP Success Criterion #3)
 * - Transport cleanup (close)
 * - Error handling for non-existent commands
 *
 * Uses a minimal MCP server script as a test fixture that speaks
 * JSON-RPC over stdio, handling initialize, tools/list, and tools/call.
 */
import { describe, test, expect, afterEach, beforeAll } from 'bun:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import {
  ListToolsResultSchema,
  CallToolResultSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { writeFileSync, unlinkSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// Minimal MCP server script that handles initialize, tools/list, and tools/call
// over JSON-RPC on stdio. Uses the MCP SDK's server-side StdioServerTransport
// for proper message framing (Content-Length headers).
const MINIMAL_MCP_SERVER = `
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({
  name: 'test-server',
  version: '1.0.0',
})

server.tool('test_tool', 'A test tool that echoes input', { message: z.string() }, async ({ message }) => {
  return {
    content: [{ type: 'text', text: 'echo: ' + message }],
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
`

let tmpDir: string
let serverScriptPath: string

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mcp-stdio-test-'))
  serverScriptPath = join(tmpDir, 'test-mcp-server.mjs')
  writeFileSync(serverScriptPath, MINIMAL_MCP_SERVER, 'utf-8')
})

afterEach(async () => {
  // Small delay to let child processes fully terminate
  await new Promise(r => setTimeout(r, 100))
})

describe('MCP stdio transport under Bun', () => {
  test('StdioClientTransport can be instantiated and started', async () => {
    const transport = new StdioClientTransport({
      command: 'bun',
      args: ['run', serverScriptPath],
      stderr: 'pipe',
    })

    const client = new Client(
      { name: 'test-client', version: '1.0.0' },
      { capabilities: {} },
    )

    // Connect should succeed (initialize handshake)
    await client.connect(transport)

    // Clean up
    await client.close()
  }, 10_000)

  test('tools/list returns non-empty array of tool definitions', async () => {
    const transport = new StdioClientTransport({
      command: 'bun',
      args: ['run', serverScriptPath],
      stderr: 'pipe',
    })

    const client = new Client(
      { name: 'test-client', version: '1.0.0' },
      { capabilities: {} },
    )

    await client.connect(transport)

    const result = await client.request(
      { method: 'tools/list' },
      ListToolsResultSchema,
    )

    expect(result.tools).toBeArray()
    expect(result.tools.length).toBeGreaterThan(0)
    expect(result.tools[0].name).toBe('test_tool')
    expect(result.tools[0].description).toBe('A test tool that echoes input')
    expect(result.tools[0].inputSchema).toBeDefined()

    await client.close()
  }, 10_000)

  test('tools/call round-trip returns expected result', async () => {
    const transport = new StdioClientTransport({
      command: 'bun',
      args: ['run', serverScriptPath],
      stderr: 'pipe',
    })

    const client = new Client(
      { name: 'test-client', version: '1.0.0' },
      { capabilities: {} },
    )

    await client.connect(transport)

    const result = await client.request(
      {
        method: 'tools/call',
        params: {
          name: 'test_tool',
          arguments: { message: 'hello' },
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
    expect(textContent!.text).toBe('echo: hello')

    await client.close()
  }, 10_000)

  test('transport.close() terminates child process without hanging', async () => {
    const transport = new StdioClientTransport({
      command: 'bun',
      args: ['run', serverScriptPath],
      stderr: 'pipe',
    })

    const client = new Client(
      { name: 'test-client', version: '1.0.0' },
      { capabilities: {} },
    )

    await client.connect(transport)

    // Verify the transport has a running process
    expect(transport.pid).not.toBeNull()
    const pid = transport.pid!

    // Close should complete without hanging
    await client.close()

    // After close, the process should be terminated
    // Give a brief moment for OS process cleanup
    await new Promise(r => setTimeout(r, 200))

    // Check if process is still running (kill(0) throws if process doesn't exist)
    let processAlive = false
    try {
      process.kill(pid, 0)
      processAlive = true
    } catch {
      processAlive = false
    }
    expect(processAlive).toBe(false)
  }, 10_000)

  test('connection to non-existent command fails with catchable error', async () => {
    const transport = new StdioClientTransport({
      command: '/nonexistent/binary/that/does/not/exist',
      args: [],
      stderr: 'pipe',
    })

    const client = new Client(
      { name: 'test-client', version: '1.0.0' },
      { capabilities: {} },
    )

    // Should throw or reject, not hang
    let threw = false
    try {
      await client.connect(transport)
    } catch (err) {
      threw = true
      expect(err).toBeDefined()
    }

    expect(threw).toBe(true)

    // Cleanup in case connect partially succeeded
    try {
      await client.close()
    } catch {
      // Ignore cleanup errors
    }
  }, 10_000)

  test('multiple tools/list and tools/call in sequence work correctly', async () => {
    const transport = new StdioClientTransport({
      command: 'bun',
      args: ['run', serverScriptPath],
      stderr: 'pipe',
    })

    const client = new Client(
      { name: 'test-client', version: '1.0.0' },
      { capabilities: {} },
    )

    await client.connect(transport)

    // First tools/list
    const list1 = await client.request(
      { method: 'tools/list' },
      ListToolsResultSchema,
    )
    expect(list1.tools.length).toBeGreaterThan(0)

    // First tools/call
    const call1 = await client.request(
      {
        method: 'tools/call',
        params: { name: 'test_tool', arguments: { message: 'first' } },
      },
      CallToolResultSchema,
    )
    const text1 = (call1.content[0] as { type: string; text: string }).text
    expect(text1).toBe('echo: first')

    // Second tools/call with different input
    const call2 = await client.request(
      {
        method: 'tools/call',
        params: { name: 'test_tool', arguments: { message: 'second' } },
      },
      CallToolResultSchema,
    )
    const text2 = (call2.content[0] as { type: string; text: string }).text
    expect(text2).toBe('echo: second')

    await client.close()
  }, 10_000)
})
