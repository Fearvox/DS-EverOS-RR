/**
 * Unit tests for memoryScan.ts — scanMemoryFiles + formatMemoryManifest.
 *
 * Uses real filesystem (tmpdir pattern) to exercise the full read + parse
 * pipeline. No module mocks needed — these functions are leaf-level.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  scanMemoryFiles,
  formatMemoryManifest,
  type MemoryHeader,
} from '../memoryScan.js'

let testDir: string

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), 'memscan-'))
})

afterEach(() => {
  try {
    rmSync(testDir, { recursive: true, force: true })
  } catch {
    // best-effort cleanup
  }
})

// ---------------------------------------------------------------------------
// Helper: write a .md file with optional frontmatter
// ---------------------------------------------------------------------------
function writeMemory(
  relativePath: string,
  opts: { description?: string; type?: string; body?: string } = {},
) {
  const fullPath = join(testDir, relativePath)
  const dir = fullPath.replace(/\/[^/]+$/, '')
  mkdirSync(dir, { recursive: true })

  const hasFrontmatter = opts.description !== undefined || opts.type !== undefined
  let content = ''
  if (hasFrontmatter) {
    content += '---\n'
    if (opts.description !== undefined) content += `description: ${opts.description}\n`
    if (opts.type !== undefined) content += `type: ${opts.type}\n`
    content += '---\n'
  }
  content += opts.body ?? 'some content'
  writeFileSync(fullPath, content)
}

// ---------------------------------------------------------------------------
// scanMemoryFiles
// ---------------------------------------------------------------------------
describe('scanMemoryFiles', () => {
  test('returns empty array for non-existent directory', async () => {
    const result = await scanMemoryFiles(
      '/tmp/does-not-exist-' + Date.now(),
      new AbortController().signal,
    )
    expect(result).toEqual([])
  })

  test('returns empty array for empty directory', async () => {
    const result = await scanMemoryFiles(testDir, new AbortController().signal)
    expect(result).toEqual([])
  })

  test('reads .md files and returns MemoryHeader[]', async () => {
    writeMemory('hello.md', { description: 'Hello memory', type: 'user' })
    const result = await scanMemoryFiles(testDir, new AbortController().signal)
    expect(result).toHaveLength(1)
    expect(result[0]!.filename).toBe('hello.md')
    expect(result[0]!.description).toBe('Hello memory')
    expect(result[0]!.type).toBe('user')
    expect(result[0]!.filePath).toBe(join(testDir, 'hello.md'))
    expect(typeof result[0]!.mtimeMs).toBe('number')
  })

  test('skips MEMORY.md (the index file)', async () => {
    writeMemory('MEMORY.md', { description: 'index', type: 'project' })
    writeMemory('real.md', { description: 'real one', type: 'feedback' })
    const result = await scanMemoryFiles(testDir, new AbortController().signal)
    expect(result).toHaveLength(1)
    expect(result[0]!.filename).toBe('real.md')
  })

  test('parses frontmatter to extract description and type', async () => {
    writeMemory('typed.md', {
      description: 'some desc',
      type: 'reference',
    })
    const result = await scanMemoryFiles(testDir, new AbortController().signal)
    expect(result[0]!.description).toBe('some desc')
    expect(result[0]!.type).toBe('reference')
  })

  test('handles missing frontmatter gracefully', async () => {
    writeFileSync(join(testDir, 'bare.md'), '# No frontmatter here\nJust body.')
    const result = await scanMemoryFiles(testDir, new AbortController().signal)
    expect(result).toHaveLength(1)
    expect(result[0]!.description).toBeNull()
    expect(result[0]!.type).toBeUndefined()
  })

  test('handles frontmatter without description or type', async () => {
    writeFileSync(
      join(testDir, 'partial.md'),
      '---\nname: something\n---\nBody text.',
    )
    const result = await scanMemoryFiles(testDir, new AbortController().signal)
    expect(result[0]!.description).toBeNull()
    expect(result[0]!.type).toBeUndefined()
  })

  test('supports recursive subdirectory scanning', async () => {
    writeMemory('sub/deep/nested.md', { description: 'deep', type: 'user' })
    writeMemory('top.md', { description: 'top', type: 'feedback' })
    const result = await scanMemoryFiles(testDir, new AbortController().signal)
    expect(result).toHaveLength(2)
    const filenames = result.map(r => r.filename)
    // subdirectory files should include relative path
    expect(filenames).toContain('top.md')
    expect(filenames.some(f => f.includes('nested.md'))).toBe(true)
  })

  test('sorts results newest-first by mtimeMs', async () => {
    writeMemory('old.md', { description: 'old' })
    // Advance mtime by touching with a delay
    const laterPath = join(testDir, 'new.md')
    writeFileSync(laterPath, '---\ndescription: new\n---\nBody')
    // Force the "old" file to have an earlier mtime
    const { utimesSync } = require('fs')
    utimesSync(join(testDir, 'old.md'), new Date(1000000), new Date(1000000))

    const result = await scanMemoryFiles(testDir, new AbortController().signal)
    expect(result).toHaveLength(2)
    expect(result[0]!.filename).toBe('new.md')
    expect(result[1]!.filename).toBe('old.md')
    expect(result[0]!.mtimeMs).toBeGreaterThan(result[1]!.mtimeMs)
  })

  test('caps results at 200 files', async () => {
    // Write 210 files
    for (let i = 0; i < 210; i++) {
      writeFileSync(
        join(testDir, `file-${String(i).padStart(3, '0')}.md`),
        `---\ndescription: file ${i}\n---\n`,
      )
    }
    const result = await scanMemoryFiles(testDir, new AbortController().signal)
    expect(result).toHaveLength(200)
  })

  test('ignores non-.md files', async () => {
    writeFileSync(join(testDir, 'readme.txt'), 'not markdown')
    writeFileSync(join(testDir, 'data.json'), '{}')
    writeMemory('real.md', { description: 'md file' })
    const result = await scanMemoryFiles(testDir, new AbortController().signal)
    expect(result).toHaveLength(1)
    expect(result[0]!.filename).toBe('real.md')
  })

  test('handles invalid type value gracefully', async () => {
    writeMemory('bad-type.md', { description: 'has bad type', type: 'INVALID' })
    const result = await scanMemoryFiles(testDir, new AbortController().signal)
    expect(result[0]!.type).toBeUndefined()
    expect(result[0]!.description).toBe('has bad type')
  })
})

// ---------------------------------------------------------------------------
// formatMemoryManifest
// ---------------------------------------------------------------------------
describe('formatMemoryManifest', () => {
  const baseMs = new Date('2026-01-15T10:30:00Z').getTime()

  test('returns empty string for empty array', () => {
    expect(formatMemoryManifest([])).toBe('')
  })

  test('formats header with type, filename, timestamp, and description', () => {
    const headers: MemoryHeader[] = [
      {
        filename: 'user_prefs.md',
        filePath: '/mem/user_prefs.md',
        mtimeMs: baseMs,
        description: 'User preferences',
        type: 'user',
      },
    ]
    const result = formatMemoryManifest(headers)
    expect(result).toBe(
      `- [user] user_prefs.md (${new Date(baseMs).toISOString()}): User preferences`,
    )
  })

  test('omits type tag when type is undefined', () => {
    const headers: MemoryHeader[] = [
      {
        filename: 'legacy.md',
        filePath: '/mem/legacy.md',
        mtimeMs: baseMs,
        description: 'Legacy note',
        type: undefined,
      },
    ]
    const result = formatMemoryManifest(headers)
    expect(result).toContain('- legacy.md (')
    expect(result).not.toContain('[')
  })

  test('omits description when description is null', () => {
    const headers: MemoryHeader[] = [
      {
        filename: 'nodesc.md',
        filePath: '/mem/nodesc.md',
        mtimeMs: baseMs,
        description: null,
        type: 'project',
      },
    ]
    const result = formatMemoryManifest(headers)
    const ts = new Date(baseMs).toISOString()
    expect(result).toBe(`- [project] nodesc.md (${ts})`)
    // No ": description" suffix — line ends with closing paren
    expect(result.endsWith(')')).toBe(true)
    // Should not have a colon after the closing paren (i.e., no description segment)
    expect(result.includes('): ')).toBe(false)
  })

  test('formats multiple headers separated by newlines', () => {
    const headers: MemoryHeader[] = [
      {
        filename: 'a.md',
        filePath: '/mem/a.md',
        mtimeMs: baseMs,
        description: 'First',
        type: 'user',
      },
      {
        filename: 'b.md',
        filePath: '/mem/b.md',
        mtimeMs: baseMs + 1000,
        description: 'Second',
        type: 'feedback',
      },
    ]
    const result = formatMemoryManifest(headers)
    const lines = result.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('[user] a.md')
    expect(lines[1]).toContain('[feedback] b.md')
  })
})
