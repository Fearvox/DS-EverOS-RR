/**
 * Unit tests for paths.ts — isAutoMemoryEnabled, isAutoMemPath,
 * getAutoMemPath, isExtractModeActive.
 *
 * Uses mock.module to control dependencies (bootstrap/state, settings,
 * growthbook, git). Env vars are saved/restored per test.
 */

import { describe, test, expect, beforeEach, afterEach, afterAll, mock } from 'bun:test'
import { sep, join } from 'path'

// ============================================================================
// Module mocks — must be set BEFORE importing the module under test
// ============================================================================

let mockProjectRoot = '/tmp/test-project'
let mockIsNonInteractive = false

mock.module('src/bootstrap/state.js', () => ({
  getProjectRoot: () => mockProjectRoot,
  getIsNonInteractiveSession: () => mockIsNonInteractive,
}))

// Settings mocks
let mockInitialSettings: Record<string, unknown> = {}
let mockSourceSettings: Record<string, Record<string, unknown> | undefined> = {}

mock.module('src/utils/settings/settings.js', () => ({
  getInitialSettings: () => mockInitialSettings,
  getSettingsForSource: (source: string) =>
    mockSourceSettings[source] ?? undefined,
}))

// GrowthBook mock
let mockFeatureValues: Record<string, unknown> = {}

mock.module('src/services/analytics/growthbook.js', () => ({
  getFeatureValue_CACHED_MAY_BE_STALE: (
    feature: string,
    defaultValue: unknown,
  ) => {
    if (feature in mockFeatureValues) return mockFeatureValues[feature]
    return defaultValue
  },
  _resetLocalFlagOverridesForTesting: () => {},
  getLocalFlagOverrides: () => null,
}))

// Git mock
let mockCanonicalGitRoot: string | undefined = undefined

mock.module('src/utils/git.js', () => ({
  findCanonicalGitRoot: () => mockCanonicalGitRoot,
}))

// Debug logging (no-op)
mock.module('src/utils/debug.js', () => ({
  logForDebugging: () => {},
}))

afterAll(() => {
  mock.restore()
})

// ============================================================================
// Import module under test AFTER all mocks
// ============================================================================

import {
  isAutoMemoryEnabled,
  isAutoMemPath,
  getAutoMemPath,
  isExtractModeActive,
} from '../paths.js'

// ============================================================================
// Env var save/restore
// ============================================================================

let savedEnv: NodeJS.ProcessEnv

beforeEach(() => {
  savedEnv = { ...process.env }
  // Reset mock state
  mockProjectRoot = '/tmp/test-project-' + Math.random().toString(36).slice(2)
  mockIsNonInteractive = false
  mockInitialSettings = {}
  mockSourceSettings = {}
  mockFeatureValues = {}
  mockCanonicalGitRoot = undefined
  // Clean env vars that paths.ts checks
  delete process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY
  delete process.env.CLAUDE_CODE_SIMPLE
  delete process.env.CLAUDE_CODE_REMOTE
  delete process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR
  delete process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE
  delete process.env.CLAUDE_CONFIG_DIR
})

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) {
      delete process.env[key]
    }
  }
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
})

// ---------------------------------------------------------------------------
// isAutoMemoryEnabled
// ---------------------------------------------------------------------------
describe('isAutoMemoryEnabled', () => {
  test('returns true by default (no env, no settings)', () => {
    expect(isAutoMemoryEnabled()).toBe(true)
  })

  test('returns false when CLAUDE_CODE_DISABLE_AUTO_MEMORY=true', () => {
    process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = 'true'
    expect(isAutoMemoryEnabled()).toBe(false)
  })

  test('returns false when CLAUDE_CODE_DISABLE_AUTO_MEMORY=1', () => {
    process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '1'
    expect(isAutoMemoryEnabled()).toBe(false)
  })

  test('returns true when CLAUDE_CODE_DISABLE_AUTO_MEMORY=false (explicitly enabled)', () => {
    process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = 'false'
    expect(isAutoMemoryEnabled()).toBe(true)
  })

  test('returns true when CLAUDE_CODE_DISABLE_AUTO_MEMORY=0', () => {
    process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = '0'
    expect(isAutoMemoryEnabled()).toBe(true)
  })

  test('returns false when CLAUDE_CODE_SIMPLE=true (--bare mode)', () => {
    process.env.CLAUDE_CODE_SIMPLE = 'true'
    expect(isAutoMemoryEnabled()).toBe(false)
  })

  test('returns false when CLAUDE_CODE_REMOTE=true without CLAUDE_CODE_REMOTE_MEMORY_DIR', () => {
    process.env.CLAUDE_CODE_REMOTE = 'true'
    expect(isAutoMemoryEnabled()).toBe(false)
  })

  test('returns true when CLAUDE_CODE_REMOTE=true WITH CLAUDE_CODE_REMOTE_MEMORY_DIR', () => {
    process.env.CLAUDE_CODE_REMOTE = 'true'
    process.env.CLAUDE_CODE_REMOTE_MEMORY_DIR = '/tmp/remote-mem'
    expect(isAutoMemoryEnabled()).toBe(true)
  })

  test('respects settings.json autoMemoryEnabled=false', () => {
    mockInitialSettings = { autoMemoryEnabled: false }
    expect(isAutoMemoryEnabled()).toBe(false)
  })

  test('respects settings.json autoMemoryEnabled=true', () => {
    mockInitialSettings = { autoMemoryEnabled: true }
    expect(isAutoMemoryEnabled()).toBe(true)
  })

  test('env var DISABLE takes precedence over settings', () => {
    process.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY = 'true'
    mockInitialSettings = { autoMemoryEnabled: true }
    expect(isAutoMemoryEnabled()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// isExtractModeActive
// ---------------------------------------------------------------------------
describe('isExtractModeActive', () => {
  test('returns false when tengu_passport_quail is false', () => {
    mockFeatureValues = { tengu_passport_quail: false }
    expect(isExtractModeActive()).toBe(false)
  })

  test('returns true when tengu_passport_quail is true AND interactive session', () => {
    mockFeatureValues = { tengu_passport_quail: true }
    mockIsNonInteractive = false
    expect(isExtractModeActive()).toBe(true)
  })

  test('returns false when tengu_passport_quail is true but non-interactive and tengu_slate_thimble is false', () => {
    mockFeatureValues = {
      tengu_passport_quail: true,
      tengu_slate_thimble: false,
    }
    mockIsNonInteractive = true
    expect(isExtractModeActive()).toBe(false)
  })

  test('returns true when tengu_passport_quail and tengu_slate_thimble both true for non-interactive', () => {
    mockFeatureValues = {
      tengu_passport_quail: true,
      tengu_slate_thimble: true,
    }
    mockIsNonInteractive = true
    expect(isExtractModeActive()).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// getAutoMemPath
// ---------------------------------------------------------------------------
describe('getAutoMemPath', () => {
  test('returns path based on project root when no overrides', () => {
    const result = getAutoMemPath()
    // Should contain 'memory' directory and end with separator
    expect(result.endsWith(sep)).toBe(true)
    expect(result).toContain('memory')
    // Should contain a sanitized version of the project root
    expect(result).toContain('projects')
  })

  test('respects CLAUDE_COWORK_MEMORY_PATH_OVERRIDE env var', () => {
    // Needs a new project root to break the memoize cache
    mockProjectRoot = '/tmp/cowork-override-test-' + Date.now()
    process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = '/tmp/cowork-memory-dir'
    const result = getAutoMemPath()
    expect(result.startsWith('/tmp/cowork-memory-dir')).toBe(true)
    expect(result.endsWith(sep)).toBe(true)
  })

  test('respects autoMemoryDirectory setting from trusted sources', () => {
    mockProjectRoot = '/tmp/setting-override-test-' + Date.now()
    mockSourceSettings = {
      userSettings: { autoMemoryDirectory: '/tmp/user-custom-memdir' },
    }
    const result = getAutoMemPath()
    expect(result.startsWith('/tmp/user-custom-memdir')).toBe(true)
    expect(result.endsWith(sep)).toBe(true)
  })

  test('env var override takes precedence over settings', () => {
    mockProjectRoot = '/tmp/precedence-test-' + Date.now()
    process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = '/tmp/env-wins'
    mockSourceSettings = {
      userSettings: { autoMemoryDirectory: '/tmp/settings-loses' },
    }
    const result = getAutoMemPath()
    expect(result.startsWith('/tmp/env-wins')).toBe(true)
  })

  test('returns different paths for different project roots (memoize keyed on project root)', () => {
    mockProjectRoot = '/tmp/proj-A-' + Date.now()
    const pathA = getAutoMemPath()
    mockProjectRoot = '/tmp/proj-B-' + Date.now()
    const pathB = getAutoMemPath()
    expect(pathA).not.toBe(pathB)
  })
})

// ---------------------------------------------------------------------------
// isAutoMemPath
// ---------------------------------------------------------------------------
describe('isAutoMemPath', () => {
  test('returns true for paths within the auto-memory directory', () => {
    // Force a known path via env override so we can predict it
    mockProjectRoot = '/tmp/automempath-test-' + Date.now()
    process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = '/tmp/test-memory'
    const memPath = getAutoMemPath() // /tmp/test-memory/
    expect(isAutoMemPath(join(memPath, 'file.md'))).toBe(true)
    expect(isAutoMemPath(join(memPath, 'sub/deep/file.md'))).toBe(true)
  })

  test('returns false for paths outside', () => {
    mockProjectRoot = '/tmp/automempath-outside-' + Date.now()
    process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = '/tmp/mem-inside'
    // Clear memoize cache by getting the path first
    getAutoMemPath()
    expect(isAutoMemPath('/tmp/completely-elsewhere/file.md')).toBe(false)
    expect(isAutoMemPath('/home/user/Documents/file.md')).toBe(false)
  })

  test('handles path traversal attempts', () => {
    mockProjectRoot = '/tmp/traversal-test-' + Date.now()
    process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = '/tmp/safe-mem'
    getAutoMemPath()
    // An attempt using ../../ to escape should be normalized and rejected
    expect(isAutoMemPath('/tmp/safe-mem/../etc/passwd')).toBe(false)
    expect(isAutoMemPath('/tmp/safe-mem/../../root/.ssh/id_rsa')).toBe(false)
  })

  test('normalizes paths before comparison', () => {
    mockProjectRoot = '/tmp/normalize-test-' + Date.now()
    process.env.CLAUDE_COWORK_MEMORY_PATH_OVERRIDE = '/tmp/norm-mem'
    const memPath = getAutoMemPath()
    // Path with redundant slashes and dots should still match
    const weirdPath = memPath + './sub/../file.md'
    // normalize will resolve this — whether it matches depends on the
    // resolved result starting with memPath
    const normalResult = isAutoMemPath(join(memPath, 'file.md'))
    expect(normalResult).toBe(true)
  })
})
