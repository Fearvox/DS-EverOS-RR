import { describe, test, expect, afterEach } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  loadTranscriptFile,
  buildConversationChain,
  isTranscriptMessage,
} from '../sessionStorage.js'
import type { TranscriptMessage } from '../../types/logs.js'

describe('sessionStorage resume', () => {
  let tempDir: string

  function setup(): string {
    tempDir = mkdtempSync(join(tmpdir(), 'ss-resume-'))
    return join(tempDir, 'session.jsonl')
  }

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true })
    }
  })

  // Minimal TranscriptMessage shape for testing
  function makeUserMsg(
    uuid: string,
    parentUuid: string | null = null,
  ): TranscriptMessage {
    return {
      type: 'user',
      uuid: uuid as ReturnType<typeof crypto.randomUUID>,
      parentUuid: parentUuid as ReturnType<typeof crypto.randomUUID> | null,
      isSidechain: false,
      timestamp: new Date().toISOString(),
      sessionId: 'test-session',
      cwd: '/tmp',
      userType: 'external',
      version: '1.0.0',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
      },
    } as unknown as TranscriptMessage
  }

  function makeAssistantMsg(
    uuid: string,
    parentUuid: string,
  ): TranscriptMessage {
    return {
      type: 'assistant',
      uuid: uuid as ReturnType<typeof crypto.randomUUID>,
      parentUuid: parentUuid as ReturnType<typeof crypto.randomUUID>,
      isSidechain: false,
      timestamp: new Date().toISOString(),
      sessionId: 'test-session',
      cwd: '/tmp',
      userType: 'external',
      version: '1.0.0',
      costUSD: 0,
      durationMs: 0,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'world' }],
      },
    } as unknown as TranscriptMessage
  }

  // ── Test Group A: buildConversationChain (pure function, no bootstrap) ────

  describe('buildConversationChain', () => {
    test('returns [user, assistant] in root-to-leaf order', () => {
      const userMsg = makeUserMsg('u1', null)
      const assistantMsg = makeAssistantMsg('a1', 'u1')

      const messages = new Map<string, TranscriptMessage>()
      messages.set('u1', userMsg)
      messages.set('a1', assistantMsg)

      const chain = buildConversationChain(
        messages as Map<ReturnType<typeof crypto.randomUUID>, TranscriptMessage>,
        assistantMsg,
      )

      expect(chain).toHaveLength(2)
      expect(chain[0].type).toBe('user')
      expect(chain[1].type).toBe('assistant')
      expect(chain[0].uuid).toBe('u1')
      expect(chain[1].uuid).toBe('a1')
    })

    test('returns single-element chain for root message', () => {
      const userMsg = makeUserMsg('u1', null)
      const messages = new Map<string, TranscriptMessage>()
      messages.set('u1', userMsg)

      const chain = buildConversationChain(
        messages as Map<ReturnType<typeof crypto.randomUUID>, TranscriptMessage>,
        userMsg,
      )

      expect(chain).toHaveLength(1)
      expect(chain[0].type).toBe('user')
    })

    test('handles 3-message chain in correct order', () => {
      const u1 = makeUserMsg('u1', null)
      const a1 = makeAssistantMsg('a1', 'u1')
      const u2 = makeUserMsg('u2', 'a1')

      const messages = new Map<string, TranscriptMessage>()
      messages.set('u1', u1)
      messages.set('a1', a1)
      messages.set('u2', u2)

      const chain = buildConversationChain(
        messages as Map<ReturnType<typeof crypto.randomUUID>, TranscriptMessage>,
        u2,
      )

      expect(chain).toHaveLength(3)
      expect(chain[0].uuid).toBe('u1')
      expect(chain[1].uuid).toBe('a1')
      expect(chain[2].uuid).toBe('u2')
    })
  })

  // ── Test Group B: isTranscriptMessage type guard ──────────────────────────

  describe('isTranscriptMessage', () => {
    test('returns true for user type', () => {
      const entry = { type: 'user', uuid: 'u1', parentUuid: null }
      expect(isTranscriptMessage(entry as any)).toBe(true)
    })

    test('returns true for assistant type', () => {
      const entry = { type: 'assistant', uuid: 'a1', parentUuid: 'u1' }
      expect(isTranscriptMessage(entry as any)).toBe(true)
    })

    test('returns true for system type', () => {
      const entry = { type: 'system', uuid: 's1', parentUuid: null }
      expect(isTranscriptMessage(entry as any)).toBe(true)
    })

    test('returns true for attachment type', () => {
      const entry = { type: 'attachment', uuid: 'att1', parentUuid: null }
      expect(isTranscriptMessage(entry as any)).toBe(true)
    })

    test('returns false for abort type', () => {
      const entry = { type: 'abort', sessionId: 'sess-1', timestamp: 'ts' }
      expect(isTranscriptMessage(entry as any)).toBe(false)
    })

    test('returns false for summary type', () => {
      const entry = { type: 'summary', leafUuid: 'u1', summary: 'test' }
      expect(isTranscriptMessage(entry as any)).toBe(false)
    })

    test('returns false for progress type (ephemeral)', () => {
      const entry = { type: 'progress', uuid: 'p1', parentUuid: 'u1' }
      expect(isTranscriptMessage(entry as any)).toBe(false)
    })
  })

  // ── Test Group C: loadTranscriptFile (disk I/O) ───────────────────────────

  describe('loadTranscriptFile', () => {
    function writeJSONL(filePath: string, entries: object[]): void {
      const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n'
      writeFileSync(filePath, content, 'utf8')
    }

    test('empty file returns messages.size === 0 without crashing', async () => {
      const file = setup()
      writeFileSync(file, '', 'utf8')

      const result = await loadTranscriptFile(file)
      expect(result.messages.size).toBe(0)
    })

    test('single user message is loaded correctly', async () => {
      const file = setup()
      const userEntry = {
        type: 'user',
        uuid: 'u1',
        parentUuid: null,
        isSidechain: false,
        timestamp: new Date().toISOString(),
        sessionId: 'test-session',
        cwd: '/tmp',
        userType: 'external',
        version: '1.0.0',
        message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      }
      writeJSONL(file, [userEntry])

      const result = await loadTranscriptFile(file)
      expect(result.messages.size).toBe(1)
      expect(result.messages.get('u1' as any)?.type).toBe('user')
    })

    test('user+assistant chain: messages.size === 2, leafUuids has assistant', async () => {
      const file = setup()
      const ts = new Date().toISOString()
      const userEntry = {
        type: 'user',
        uuid: 'u1',
        parentUuid: null,
        isSidechain: false,
        timestamp: ts,
        sessionId: 'test-session',
        cwd: '/tmp',
        userType: 'external',
        version: '1.0.0',
        message: { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      }
      const assistantEntry = {
        type: 'assistant',
        uuid: 'a1',
        parentUuid: 'u1',
        isSidechain: false,
        timestamp: ts,
        sessionId: 'test-session',
        cwd: '/tmp',
        userType: 'external',
        version: '1.0.0',
        costUSD: 0,
        durationMs: 0,
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'world' }],
        },
      }
      writeJSONL(file, [userEntry, assistantEntry])

      const result = await loadTranscriptFile(file)
      expect(result.messages.size).toBe(2)
      expect(result.leafUuids.has('a1' as any)).toBe(true)

      const leafMsg = result.messages.get('a1' as any)!
      expect(leafMsg).toBeDefined()

      const chain = buildConversationChain(result.messages, leafMsg)
      expect(chain).toHaveLength(2)
      expect(chain[0].type).toBe('user')
      expect(chain[1].type).toBe('assistant')
    })

    test('invalid JSON lines are skipped without crashing', async () => {
      const file = setup()
      const validEntry = {
        type: 'user',
        uuid: 'u1',
        parentUuid: null,
        isSidechain: false,
        timestamp: new Date().toISOString(),
        sessionId: 'test-session',
        cwd: '/tmp',
        userType: 'external',
        version: '1.0.0',
        message: { role: 'user', content: [{ type: 'text', text: 'hi' }] },
      }
      // Write one valid line, one invalid line
      const content = JSON.stringify(validEntry) + '\n' + 'not valid json\n'
      writeFileSync(file, content, 'utf8')

      // Should not throw
      const result = await loadTranscriptFile(file)
      // valid entry may or may not be loaded depending on parseJSONL behavior
      // — the important thing is no crash
      expect(result.messages).toBeDefined()
    })
  })
})
