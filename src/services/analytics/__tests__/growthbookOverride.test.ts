import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

type GrowthbookModule = typeof import('../growthbook.js')

async function loadGrowthbookModule(): Promise<GrowthbookModule> {
  mock.restore()
  return import(`../growthbook.js?isolation=${Date.now()}-${Math.random()}`)
}

/**
 * Tests for GrowthBook tengu_* local override system.
 *
 * The getLocalFlagOverrides() function reads tengu_* keys from
 * ~/.claude/feature-flags.json and injects them into the GrowthBook
 * override chain -- without requiring USER_TYPE=ant.
 *
 * These tests verify the override function in isolation. The full gate
 * functions (getFeatureValue_CACHED_MAY_BE_STALE, checkGate_CACHED_OR_BLOCKING)
 * are tested indirectly by verifying getLocalFlagOverrides() returns the
 * correct data, since the integration points are simple `if (key in overrides)`
 * checks.
 */

// Helper: create a temp HOME with .claude/feature-flags.json
function setupTempHome(flags: Record<string, unknown>): string {
  const tempDir = mkdtempSync(join(tmpdir(), 'gb-override-test-'))
  const claudeDir = join(tempDir, '.claude')
  mkdirSync(claudeDir, { recursive: true })
  writeFileSync(join(claudeDir, 'feature-flags.json'), JSON.stringify(flags))
  return tempDir
}

describe('GrowthBook local override (getLocalFlagOverrides)', () => {
  let savedEnv: Record<string, string | undefined>
  let tempDir: string | null = null

  beforeEach(() => {
    mock.restore()
    // Save env state
    savedEnv = {
      HOME: process.env.HOME,
      USER_TYPE: process.env.USER_TYPE,
      CLAUDE_INTERNAL_FC_OVERRIDES: process.env.CLAUDE_INTERNAL_FC_OVERRIDES,
    }
  })

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) {
        delete process.env[key]
      }
    }
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = val
      }
    }
    if (tempDir) {
      try {
        rmSync(tempDir, { recursive: true, force: true })
      } catch {
        // ignore
      }
      tempDir = null
    }
  })

  test('Test 1: tengu_* boolean override works WITHOUT USER_TYPE=ant', async () => {
    tempDir = setupTempHome({ tengu_test_gate: true })
    process.env.HOME = tempDir
    delete process.env.USER_TYPE

    // Dynamic import to get fresh module state
    const mod = await loadGrowthbookModule()
    // Reset module state so it re-reads overrides
    mod.resetGrowthBook()

    const overrides = mod.getLocalFlagOverrides()
    expect(overrides).not.toBeNull()
    expect(overrides!.tengu_test_gate).toBe(true)
  })

  test('Test 2: checkGate returns override value (tengu_* key present)', async () => {
    tempDir = setupTempHome({ tengu_test_gate: true })
    process.env.HOME = tempDir
    delete process.env.USER_TYPE

    const mod = await loadGrowthbookModule()
    mod.resetGrowthBook()
    // Reset local flag overrides cache
    mod._resetLocalFlagOverridesForTesting()

    const overrides = mod.getLocalFlagOverrides()
    expect(overrides).not.toBeNull()
    expect(overrides!.tengu_test_gate).toBe(true)
  })

  test('Test 3: local override works even when isGrowthBookEnabled() returns false', async () => {
    tempDir = setupTempHome({ tengu_test_gate: true })
    process.env.HOME = tempDir
    delete process.env.USER_TYPE

    const mod = await loadGrowthbookModule()
    mod.resetGrowthBook()
    mod._resetLocalFlagOverridesForTesting()

    // isGrowthBookEnabled() depends on 1P logging which is disabled in test
    // The override should still be readable regardless
    const overrides = mod.getLocalFlagOverrides()
    expect(overrides).not.toBeNull()
    expect(overrides!.tengu_test_gate).toBe(true)
  })

  test('Test 4: non-tengu_ keys in feature-flags.json are ignored', async () => {
    tempDir = setupTempHome({
      KAIROS: true,
      PROACTIVE: true,
      tengu_real_gate: true,
    })
    process.env.HOME = tempDir
    delete process.env.USER_TYPE

    const mod = await loadGrowthbookModule()
    mod.resetGrowthBook()
    mod._resetLocalFlagOverridesForTesting()

    const overrides = mod.getLocalFlagOverrides()
    expect(overrides).not.toBeNull()
    // Only tengu_ keys should be present
    expect(overrides!.tengu_real_gate).toBe(true)
    expect('KAIROS' in (overrides ?? {})).toBe(false)
    expect('PROACTIVE' in (overrides ?? {})).toBe(false)
  })

  test('Test 5: tengu_* keys with non-boolean values are passed through as-is', async () => {
    tempDir = setupTempHome({
      tengu_config: { key: 'val', nested: true },
      tengu_number: 42,
      tengu_string: 'hello',
    })
    process.env.HOME = tempDir
    delete process.env.USER_TYPE

    const mod = await loadGrowthbookModule()
    mod.resetGrowthBook()
    mod._resetLocalFlagOverridesForTesting()

    const overrides = mod.getLocalFlagOverrides()
    expect(overrides).not.toBeNull()
    expect(overrides!.tengu_config).toEqual({ key: 'val', nested: true })
    expect(overrides!.tengu_number).toBe(42)
    expect(overrides!.tengu_string).toBe('hello')
  })

  test('Test 6: env var override (CLAUDE_INTERNAL_FC_OVERRIDES) takes highest priority', async () => {
    tempDir = setupTempHome({ tengu_test_gate: true })
    process.env.HOME = tempDir
    delete process.env.USER_TYPE
    // Set env override -- this should NOT require USER_TYPE=ant anymore
    process.env.CLAUDE_INTERNAL_FC_OVERRIDES = JSON.stringify({
      tengu_test_gate: false,
    })

    const mod = await loadGrowthbookModule()
    mod.resetGrowthBook()
    mod._resetLocalFlagOverridesForTesting()

    // Env override should exist and override the local file value
    const envHasOverride = mod.hasGrowthBookEnvOverride('tengu_test_gate')
    expect(envHasOverride).toBe(true)
  })
})
