import { describe, test, expect } from 'bun:test'
import { isUrl, downloadMcpb } from '../mcpbHandler.js'

describe('isUrl', () => {
  test('accepts https:// URLs', () => {
    expect(isUrl('https://example.com/plugin.mcpb')).toBe(true)
  })

  test('rejects http:// URLs', () => {
    expect(isUrl('http://example.com/plugin.mcpb')).toBe(false)
  })

  test('rejects non-URL strings', () => {
    expect(isUrl('file:///local/plugin.mcpb')).toBe(false)
    expect(isUrl('git@github.com:example/plugin.mcpb')).toBe(false)
    expect(isUrl('/absolute/path/plugin.mcpb')).toBe(false)
    expect(isUrl('relative/path/plugin.mcpb')).toBe(false)
  })
})

describe('downloadMcpb', () => {
  test('rejects http:// URLs with descriptive error', async () => {
    await expect(
      downloadMcpb('http://example.com/plugin.mcpb', '/tmp/dest'),
    ).rejects.toThrow(/MCPB download rejected.*http:\/\/ URLs are not supported/)
  })
})
