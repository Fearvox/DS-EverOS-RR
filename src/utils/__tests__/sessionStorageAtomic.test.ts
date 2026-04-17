import { describe, test, expect, afterEach } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

import { finalizeHistoryOnAbort } from '../sessionStorage.js'

describe('sessionStorage atomic writes', () => {
  let tempDir: string

  function setup(): string {
    tempDir = mkdtempSync(join(tmpdir(), 'ss-atomic-'))
    return join(tempDir, 'test-session.jsonl')
  }

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  describe('finalizeHistoryOnAbort', () => {
    test('writes a valid JSON abort marker entry', () => {
      const file = setup()
      finalizeHistoryOnAbort(file, 'test-session-123')

      const content = readFileSync(file, 'utf8')
      const lines = content.split('\n').filter(Boolean)
      expect(lines).toHaveLength(1)

      const entry = JSON.parse(lines[0])
      expect(entry.type).toBe('abort')
      expect(entry.sessionId).toBe('test-session-123')
      expect(typeof entry.timestamp).toBe('string')
      // Verify timestamp is valid ISO 8601
      expect(new Date(entry.timestamp).toISOString()).toBe(entry.timestamp)
    })

    test('is idempotent -- calling twice produces two valid entries', () => {
      const file = setup()
      finalizeHistoryOnAbort(file, 'sess-1')
      finalizeHistoryOnAbort(file, 'sess-1')

      const content = readFileSync(file, 'utf8')
      const lines = content.split('\n').filter(Boolean)
      expect(lines).toHaveLength(2)

      for (const line of lines) {
        const entry = JSON.parse(line)
        expect(entry.type).toBe('abort')
        expect(entry.sessionId).toBe('sess-1')
      }
    })

    test('every line in output is valid JSON (JSONL format)', () => {
      const file = setup()
      finalizeHistoryOnAbort(file, 'sess-a')
      finalizeHistoryOnAbort(file, 'sess-b')
      finalizeHistoryOnAbort(file, 'sess-c')

      const content = readFileSync(file, 'utf8')
      const lines = content.split('\n').filter(Boolean)
      expect(lines).toHaveLength(3)

      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow()
      }
    })

    test('creates parent directory if it does not exist', () => {
      tempDir = mkdtempSync(join(tmpdir(), 'ss-atomic-'))
      const nested = join(tempDir, 'nested', 'deep', 'session.jsonl')

      finalizeHistoryOnAbort(nested, 'sess-nested')

      expect(existsSync(nested)).toBe(true)
      const entry = JSON.parse(readFileSync(nested, 'utf8').trim())
      expect(entry.type).toBe('abort')
    })

    test('does not throw when called with non-writable path (best-effort)', () => {
      // finalizeHistoryOnAbort catches all errors internally
      expect(() => {
        finalizeHistoryOnAbort('/dev/null/impossible/path.jsonl', 'sess-err')
      }).not.toThrow()
    })

    test('abort marker entry has exactly three fields', () => {
      const file = setup()
      finalizeHistoryOnAbort(file, 'sess-fields')

      const entry = JSON.parse(readFileSync(file, 'utf8').trim())
      const keys = Object.keys(entry).sort()
      expect(keys).toEqual(['sessionId', 'timestamp', 'type'])
    })

    test('different sessionIds produce distinct entries', () => {
      const file = setup()
      finalizeHistoryOnAbort(file, 'alpha')
      finalizeHistoryOnAbort(file, 'beta')

      const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
      const entries = lines.map(l => JSON.parse(l))
      expect(entries[0].sessionId).toBe('alpha')
      expect(entries[1].sessionId).toBe('beta')
    })
  })

  describe('JSONL format integrity', () => {
    test('each entry ends with newline (no trailing partial lines)', () => {
      const file = setup()
      finalizeHistoryOnAbort(file, 'sess-nl')

      const raw = readFileSync(file, 'utf8')
      // File should end with exactly one newline after the JSON
      expect(raw.endsWith('\n')).toBe(true)
      // No double newlines
      expect(raw.includes('\n\n')).toBe(false)
    })

    test('multiple entries produce exactly N newline-terminated lines', () => {
      const file = setup()
      const count = 5
      for (let i = 0; i < count; i++) {
        finalizeHistoryOnAbort(file, `sess-${i}`)
      }

      const raw = readFileSync(file, 'utf8')
      const lines = raw.split('\n')
      // Last split element should be empty string (trailing newline)
      expect(lines[lines.length - 1]).toBe('')
      // Non-empty lines should equal count
      expect(lines.filter(Boolean)).toHaveLength(count)
    })
  })
})
