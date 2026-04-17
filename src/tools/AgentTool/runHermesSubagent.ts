import { spawn } from 'child_process'
import { randomUUID } from 'crypto'
import type { Message } from '../../types/message.js'
import { getProjectRoot } from '../../bootstrap/state.js'
import { logForDebugging } from '../../utils/debug.js'

const HERMES_BIN = '${HOME}/.local/bin/hermes'

export interface HermesSubagentOptions {
  prompt: string
  cwd?: string
  signal?: AbortSignal
}

/**
 * Spawn Hermes as a CLI subprocess and yield its stdout as messages.
 *
 * Hermes is NOT an API-based agent — it runs as:
 *   hermes -q "{prompt}" --directory {cwd}
 *
 * This function bridges the CLI subprocess to the agent message interface.
 */
export async function* runHermesSubagent({
  prompt,
  cwd,
  signal,
}: HermesSubagentOptions): AsyncGenerator<Message> {
  const workingDir = cwd ?? getProjectRoot()

  logForDebugging(`[Hermes subagent] spawning: ${HERMES_BIN} -q "${prompt}" --directory ${workingDir}`)

  // Yield a progress message indicating Hermes has been dispatched
  yield {
    type: 'progress',
    uuid: randomUUID(),
    message: {
      type: 'progress',
      description: `Dispatching to Hermes...`,
    },
  } as Message

  // Spawn Hermes CLI
  const child = spawn(HERMES_BIN, ['-q', prompt, '--directory', workingDir], {
    cwd: workingDir,
    signal,
    // Capture stdout and stderr
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env },
  })

  let stdout = ''
  let stderr = ''

  // Collect stdout
  if (child.stdout) {
    for await (const chunk of child.stdout) {
      stdout += chunk.toString()
    }
  }

  // Collect stderr (log only)
  if (child.stderr) {
    for await (const chunk of child.stderr) {
      stderr += chunk.toString()
    }
  }

  // Wait for process to exit
  const exitCode = await new Promise<number>(resolve => {
    child.on('close', code => resolve(code ?? 1))
  })

  if (stderr) {
    logForDebugging(`[Hermes subagent] stderr: ${stderr}`)
  }

  logForDebugging(`[Hermes subagent] exited with code ${exitCode}`)

  if (exitCode !== 0) {
    // Yield error as a user message with error content
    yield {
      type: 'user',
      uuid: randomUUID(),
      message: {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `[Hermes error: exited with code ${exitCode}]\n${stderr || stdout}`,
          },
        ],
      },
    } as Message
    return
  }

  // Yield Hermes stdout as a user message (acts as the "result")
  // This gets recorded in the agent transcript and returned to CCR
  yield {
    type: 'user',
    uuid: randomUUID(),
    message: {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `[Hermes result]\n${stdout}`,
        },
      ],
    },
  } as Message
}