/**
 * MCP tool assembly integration tests.
 *
 * Proves that fetchToolsForClient() correctly wraps MCP protocol tools
 * into the internal Tool format with:
 * - Namespaced name (mcp__{server}__{tool})
 * - Description from MCP server
 * - inputJSONSchema from MCP server
 * - Callable call() function
 * - mcpInfo with serverName and toolName
 * - isMcp flag set to true
 *
 * Uses a mock ConnectedMCPServer to avoid actual transport connectivity
 * (transport tests are covered in stdioTransport.test.ts and sseTransport.test.ts).
 */
import { describe, test, expect, beforeAll } from 'bun:test'
import type { ConnectedMCPServer } from '../types.js'

// We need to dynamically import fetchToolsForClient because client.ts
// has heavy transitive dependencies. The function itself only needs
// the MCPServerConnection mock with a client.request method.
let fetchToolsForClient: (client: ConnectedMCPServer) => Promise<any[]>

beforeAll(async () => {
  // Set env to avoid sandbox checks in transitive imports
  process.env.CLAUDE_CODE_DISABLE_SANDBOX = '1'

  const mod = await import('../client.js')
  fetchToolsForClient = mod.fetchToolsForClient as any
})

function createMockConnectedServer(
  serverName: string,
  toolsListResponse: { tools: any[] },
): ConnectedMCPServer {
  return {
    client: {
      request: async (req: any, _schema: any) => {
        if (req.method === 'tools/list') {
          return toolsListResponse
        }
        if (req.method === 'tools/call') {
          return {
            content: [{ type: 'text', text: 'mock-result' }],
          }
        }
        throw new Error(`Unexpected method: ${req.method}`)
      },
    } as any,
    name: serverName,
    type: 'connected',
    capabilities: { tools: {} },
    serverInfo: { name: serverName, version: '1.0.0' },
    config: { type: 'stdio', command: 'echo', args: [], scope: 'local' } as any,
    cleanup: async () => {},
  }
}

describe('fetchToolsForClient - MCP tool assembly', () => {
  test('wraps MCP tools with namespaced name, description, inputJSONSchema, and call', async () => {
    const mockServer = createMockConnectedServer('my-server', {
      tools: [
        {
          name: 'read_file',
          description: 'Read a file from disk',
          inputSchema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
          },
        },
      ],
    })

    const tools = await fetchToolsForClient(mockServer)

    expect(tools).toBeArray()
    expect(tools.length).toBe(1)

    const tool = tools[0]

    // Name should be namespaced with mcp__ prefix
    expect(tool.name).toMatch(/^mcp__/)
    expect(tool.name).toContain('my-server')
    expect(tool.name).toContain('read_file')

    // Description should come from MCP server
    const desc = await tool.description({}, {})
    expect(desc).toBe('Read a file from disk')

    // inputJSONSchema should match MCP response
    expect(tool.inputJSONSchema).toBeDefined()
    expect(tool.inputJSONSchema.type).toBe('object')
    expect(tool.inputJSONSchema.properties).toHaveProperty('path')

    // call should be a function
    expect(typeof tool.call).toBe('function')

    // mcpInfo should preserve original names
    expect(tool.mcpInfo).toBeDefined()
    expect(tool.mcpInfo.serverName).toBe('my-server')
    expect(tool.mcpInfo.toolName).toBe('read_file')
  })

  test('isMcp flag is set on all MCP tools', async () => {
    const mockServer = createMockConnectedServer('test-srv', {
      tools: [
        {
          name: 'tool_a',
          description: 'Tool A',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'tool_b',
          description: 'Tool B',
          inputSchema: { type: 'object', properties: {} },
        },
      ],
    })

    const tools = await fetchToolsForClient(mockServer)

    expect(tools.length).toBe(2)
    for (const tool of tools) {
      expect(tool.isMcp).toBe(true)
    }
  })

  test('returns empty array for non-connected server', async () => {
    const failedServer = {
      name: 'failed-server',
      type: 'failed' as const,
      config: { type: 'stdio', command: 'echo', args: [], scope: 'local' } as any,
      error: 'Connection failed',
    }

    const tools = await fetchToolsForClient(failedServer as any)
    expect(tools).toBeArray()
    expect(tools.length).toBe(0)
  })

  test('returns empty array when server has no tools capability', async () => {
    const noToolsServer: ConnectedMCPServer = {
      client: {
        request: async () => {
          throw new Error('Should not be called')
        },
      } as any,
      name: 'no-tools-server',
      type: 'connected',
      capabilities: {}, // No tools capability
      config: { type: 'stdio', command: 'echo', args: [], scope: 'local' } as any,
      cleanup: async () => {},
    }

    const tools = await fetchToolsForClient(noToolsServer)
    expect(tools).toBeArray()
    expect(tools.length).toBe(0)
  })
})
