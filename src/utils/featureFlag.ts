import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

function loadFlagsFromDisk(): Record<string, boolean> {
  try {
    const flagFile = join(
      process.env.HOME || '',
      '.claude',
      'feature-flags.json',
    )
    if (existsSync(flagFile)) {
      const data = JSON.parse(readFileSync(flagFile, 'utf-8'))
      const validated: Record<string, boolean> = {}
      for (const [key, val] of Object.entries(data)) {
        if (typeof val === 'boolean') {
          validated[key] = val
        }
      }
      return validated
    }
  } catch {
    // Silent fail -- fall back to all-false
  }
  return {}
}

let _flagCache: Record<string, boolean> = loadFlagsFromDisk()

export function feature(name: string): boolean {
  if (process.env.CLAUDE_FEATURE_ALL === 'true') return true
  const envVal = process.env[`CLAUDE_FEATURE_${name}`]
  if (envVal !== undefined) return envVal === 'true' || envVal === '1'
  return _flagCache[name] ?? false
}

export function getAllFlags(): Record<string, boolean> {
  return { ..._flagCache }
}

/**
 * Re-read flags from disk. Exposed for testing only.
 * @internal
 */
export function _reloadFlagsForTesting(): void {
  _flagCache = loadFlagsFromDisk()
}
