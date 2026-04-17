/**
 * FileEditTool integration tests.
 *
 * Tests exercise FileEditTool.call() and validateInput() with real filesystem
 * operations in isolated temp directories. Only the ToolUseContext boundary
 * is mocked (via createTestToolUseContext).
 *
 * Key behaviors verified:
 * - Happy path: old_string replaced with new_string in real file
 * - Invalid edit (old_string not found) is rejected by validateInput, file unchanged
 * - readFileState guard: edit rejected if file was not previously read
 * - Atomic write: writeFileSyncAndFlush_DEPRECATED uses temp+rename pattern
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises'
import { writeFileSync, existsSync, readdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createTestToolUseContext } from '../../__tests__/createTestToolUseContext.js'
import { FileEditTool } from '../FileEditTool.js'
import { writeFileSyncAndFlush_DEPRECATED } from '../../../utils/file.js'

// Mock canUseTool: always allow
const mockCanUseTool = async () => ({ result: 'allow' as const })

// Mock parent assistant message with tool_use content block
const mockParentMessage = {
  type: 'assistant' as const,
  content: [
    { type: 'tool_use', id: 'test-edit-id', name: 'Edit', input: {} },
  ],
  message: { role: 'assistant' as const, content: [] },
  costUSD: 0,
  durationMs: 0,
  uuid: 'test-edit-uuid',
}

let testDir: string

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'ccb-fileedit-test-'))
})

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true })
})

describe('FileEditTool', () => {
  test('happy path: replaces old_string with new_string in file', async () => {
    const filePath = join(testDir, 'hello.txt')
    const originalContent = 'Hello World\nGoodbye World\n'
    writeFileSync(filePath, originalContent)

    const ctx = createTestToolUseContext()
    // Pitfall 3: pre-populate readFileState so validateInput passes
    ctx.readFileState.set(filePath, {
      content: originalContent,
      timestamp: Date.now(),
      offset: undefined,
      limit: undefined,
    })

    const result = await FileEditTool.call(
      {
        file_path: filePath,
        old_string: 'Hello World',
        new_string: 'Hello Universe',
      },
      ctx as any,
      mockCanUseTool as any,
      mockParentMessage as any,
    )

    // Verify the tool returned data
    expect(result.data).toBeDefined()
    expect(result.data.filePath).toBe(filePath)

    // Verify the file on disk has the new content
    const updatedContent = await readFile(filePath, 'utf8')
    expect(updatedContent).toContain('Hello Universe')
    expect(updatedContent).toContain('Goodbye World')
    expect(updatedContent).not.toContain('Hello World')
  })

  test('invalid edit: old_string not found rejects via validateInput', async () => {
    const filePath = join(testDir, 'preserve.txt')
    const originalContent = 'Line one\nLine two\nLine three\n'
    writeFileSync(filePath, originalContent)

    const ctx = createTestToolUseContext()
    ctx.readFileState.set(filePath, {
      content: originalContent,
      timestamp: Date.now(),
      offset: undefined,
      limit: undefined,
    })

    // validateInput should reject when old_string doesn't exist in file
    const validation = await FileEditTool.validateInput(
      {
        file_path: filePath,
        old_string: 'NONEXISTENT STRING',
        new_string: 'replacement',
      },
      ctx as any,
    )

    expect(validation.result).toBe(false)
    if (!validation.result) {
      expect(validation.errorCode).toBe(8)
      expect(validation.message).toContain('String to replace not found')
    }

    // Verify original file is unchanged
    const preserved = await readFile(filePath, 'utf8')
    expect(preserved).toBe(originalContent)
  })

  test('readFileState guard: rejects edit if file was not previously read', async () => {
    const filePath = join(testDir, 'unread.txt')
    const originalContent = 'Some content here\n'
    writeFileSync(filePath, originalContent)

    // Create context WITHOUT pre-populating readFileState
    const ctx = createTestToolUseContext()

    const validation = await FileEditTool.validateInput(
      {
        file_path: filePath,
        old_string: 'Some content',
        new_string: 'New content',
      },
      ctx as any,
    )

    expect(validation.result).toBe(false)
    if (!validation.result) {
      expect(validation.errorCode).toBe(6)
      expect(validation.message).toContain('File has not been read yet')
    }

    // Original file unchanged
    const preserved = await readFile(filePath, 'utf8')
    expect(preserved).toBe(originalContent)
  })

  test('atomic write: writeFileSyncAndFlush_DEPRECATED writes content correctly via temp+rename', async () => {
    const filePath = join(testDir, 'atomic.txt')
    const content = 'Atomically written content\nWith multiple lines\n'

    // Write using the atomic function directly
    writeFileSyncAndFlush_DEPRECATED(filePath, content, { encoding: 'utf8' })

    // Verify content was written correctly
    const result = await readFile(filePath, 'utf8')
    expect(result).toBe(content)

    // Verify no leftover temp files (temp file should be renamed away)
    const files = readdirSync(testDir)
    expect(files).toHaveLength(1)
    expect(files[0]).toBe('atomic.txt')
  })

  test('atomic write: preserves existing file when overwriting', async () => {
    const filePath = join(testDir, 'overwrite.txt')
    writeFileSync(filePath, 'original')

    writeFileSyncAndFlush_DEPRECATED(filePath, 'updated', { encoding: 'utf8' })

    const result = await readFile(filePath, 'utf8')
    expect(result).toBe('updated')

    // No temp files left
    const files = readdirSync(testDir)
    expect(files).toHaveLength(1)
  })
})
