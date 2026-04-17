'use client'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { ToolCallProgress, ToolUseContext } from '../../Tool.js'
import type { AssistantMessage } from '../../types/message.js'
import type { BashProgress } from '../../types/tools.js'
import { exec } from '../../utils/Shell.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { expandPath } from '../../utils/path.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    /** Shell script to run; output streams to Claude in real-time */
    script: z.string().describe('Shell script to run; output streams to Claude in real-time'),
    /** Optional description shown in the task status bar */
    description: z.string().optional().describe('Description shown in the task status bar'),
    /** Working directory for the script (default: process.cwd()) */
    cwd: z.string().optional().describe('Working directory for the script'),
    /** Timeout in ms (default: 30 minutes) */
    timeout: z.number().optional().describe('Timeout in milliseconds'),
  }),
)

type InputSchema = z.infer<ReturnType<typeof inputSchema>>

export const MonitorTool = buildTool({
  name: 'Monitor',
  aliases: ['monitor', 'Monitor'],
  get inputSchema() {
    return inputSchema()
  },
  maxResultSizeChars: Infinity,

  isEnabled() {
    return true
  },

  async call(
    input: InputSchema,
    toolUseContext: ToolUseContext,
    _canUseTool?: unknown,
    _parentMessage?: AssistantMessage,
    onProgress?: ToolCallProgress<BashProgress>,
  ) {
    const { script, description, cwd, timeout } = input
    const { abortController } = toolUseContext

    const resolvedCwd = cwd ? expandPath(cwd) : process.cwd()
    const resolvedTimeout = timeout ?? 30 * 60 * 1000

    // Accumulate output for final result
    let fullOutput = ''
    let progressCounter = 0

    // exec() spawns the shell script and calls onProgress for each output chunk.
    // This is the same core used by BashTool — we get real-time streaming without
    // needing BashTool's permission/prompt infrastructure.
    const shellCommand = await exec(script, abortController.signal, 'bash', {
      timeout: resolvedTimeout,
      cwd: resolvedCwd,
      onProgress(lastLines) {
        // Stream each output chunk to Claude immediately
        if (onProgress) {
          onProgress({
            toolUseID: `monitor-${progressCounter++}`,
            data: {
              type: 'bash_progress',
              output: lastLines,
              fullOutput: '',
              elapsedTimeSeconds: 0,
              totalLines: 0,
              totalBytes: 0,
              taskId: undefined,
              timeoutMs: resolvedTimeout,
            } as BashProgress,
          })
        }
        fullOutput += lastLines
      },
      preventCwdChanges: true,
      shouldUseSandbox: () => false,
    })

    // Block until script completes (onProgress already streamed all chunks)
    const result = await shellCommand.result

    return {
      data: {
        success: result.code === 0,
        exitCode: result.code,
        output: fullOutput || result.stdout || '',
        stderr: result.stderr || '',
        timedOut: !!result.timedOut,
      },
    }
  },

  async prompt() {
    return 'Run a shell script with real-time streaming output. The script runs in a subprocess and progress is reported as it executes.'
  },

  async description() {
    return 'Run a shell script and stream its real-time output as progress events'
  },

  userFacingName() {
    return 'Monitor'
  },

  isReadOnly() {
    return false
  },

  isConcurrencySafe() {
    return true
  },

  isDestructive() {
    return false
  },
} as ToolDef<InputSchema, unknown, BashProgress>)

export default MonitorTool