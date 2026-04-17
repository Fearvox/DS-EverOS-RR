/**
 * BashTool integration tests.
 *
 * Tests exercise the real BashTool.call() method with actual shell execution.
 * Only the ToolUseContext boundary is mocked (via createTestToolUseContext).
 *
 * CLAUDE_CODE_DISABLE_SANDBOX=1 must be set to prevent sandbox interference.
 */
import { describe, test, expect, beforeAll } from 'bun:test'
import { ShellError } from 'src/utils/errors.js'
import { createTestToolUseContext } from '../../__tests__/createTestToolUseContext.js'

// Disable sandbox before importing BashTool (module-level side effects)
beforeAll(() => {
  process.env.CLAUDE_CODE_DISABLE_SANDBOX = '1'
})

// Lazy import to ensure env is set before module loads
async function getBashTool() {
  const mod = await import('../BashTool.js')
  return mod.BashTool
}

// Mock canUseTool: always allow
const mockCanUseTool = async () => ({ result: 'allow' as const })

// Mock parent assistant message with tool_use content block
const mockParentMessage = {
  type: 'assistant' as const,
  content: [{ type: 'tool_use', id: 'test-id', name: 'Bash', input: {} }],
  message: { role: 'assistant' as const, content: [] },
  costUSD: 0,
  durationMs: 0,
  uuid: 'test-uuid',
}

describe('BashTool', () => {
  test('happy path: echo returns output', async () => {
    const BashTool = await getBashTool()
    const ctx = createTestToolUseContext()

    const result = await BashTool.call(
      { command: 'echo hello' },
      ctx,
      mockCanUseTool as any,
      mockParentMessage as any,
    )

    expect(result.data.stdout).toContain('hello')
  })

  test('non-zero exit throws ShellError with correct code', async () => {
    const BashTool = await getBashTool()
    const ctx = createTestToolUseContext()

    try {
      await BashTool.call(
        { command: 'exit 42' },
        ctx,
        mockCanUseTool as any,
        mockParentMessage as any,
      )
      expect.unreachable('should have thrown ShellError')
    } catch (e) {
      expect(e).toBeInstanceOf(ShellError)
      expect((e as ShellError).code).toBe(42)
    }
  })

  test('stderr propagation: stderr content appears in ShellError output', async () => {
    const BashTool = await getBashTool()
    const ctx = createTestToolUseContext()

    try {
      await BashTool.call(
        { command: 'echo "error output" >&2; exit 1' },
        ctx,
        mockCanUseTool as any,
        mockParentMessage as any,
      )
      expect.unreachable('should have thrown ShellError')
    } catch (e) {
      expect(e).toBeInstanceOf(ShellError)
      const shellErr = e as ShellError
      expect(shellErr.code).toBe(1)
      // stderr is merged into stdout in BashTool (merged fd)
      // The error content should be in stderr field of ShellError
      const combinedOutput = shellErr.stdout + shellErr.stderr
      expect(combinedOutput).toContain('error output')
    }
  })

  test('timeout: long-running command is killed', async () => {
    const BashTool = await getBashTool()
    const ctx = createTestToolUseContext()

    try {
      await BashTool.call(
        { command: 'sleep 60', timeout: 1000 },
        ctx,
        mockCanUseTool as any,
        mockParentMessage as any,
      )
      expect.unreachable('should have thrown or been interrupted')
    } catch (e) {
      // Either ShellError (non-zero exit from kill) or interrupted
      expect(e).toBeDefined()
      if (e instanceof ShellError) {
        expect(e.code).not.toBe(0)
      }
    }
  }, 10_000) // 10s test timeout

  test('command semantics: grep exit 1 is not a ShellError', async () => {
    const BashTool = await getBashTool()
    const ctx = createTestToolUseContext()

    // grep returns exit code 1 when no matches found -- this is NOT an error
    const result = await BashTool.call(
      { command: 'grep nonexistent /dev/null' },
      ctx,
      mockCanUseTool as any,
      mockParentMessage as any,
    )

    // Should complete successfully (not throw) even though exit code is 1
    expect(result.data).toBeDefined()
  })
})
