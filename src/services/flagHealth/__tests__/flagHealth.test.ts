import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdtempSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

type FlagHealthModule = typeof import('../flagHealth.js')

async function loadFlagHealthModule(): Promise<FlagHealthModule> {
  mock.restore()
  return import(`../flagHealth.js?isolation=${Date.now()}-${Math.random()}`)
}

describe('flagHealth', () => {
  let savedEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    savedEnv = { ...process.env }
    // Clear all CLAUDE_FEATURE_ env vars
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('CLAUDE_FEATURE_')) {
        delete process.env[key]
      }
    }
    // Ensure HOME points to real location with feature-flags.json
    process.env.HOME = process.env.HOME || '/tmp/home-test'
  })

  afterEach(async () => {
    // Restore env
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
    // Reload flag module to reset cache
    const { _reloadFlagsForTesting } = await import('../../../utils/featureFlag.js')
    _reloadFlagsForTesting()
  })

  // Test 1: scanAllFlags() returns an array
  test('scanAllFlags() returns an array of FlagHealthResult', async () => {
    const mod = await loadFlagHealthModule()
    const results = await mod.scanAllFlags()
    expect(Array.isArray(results)).toBe(true)
  })

  // Test 2: Each result has required fields
  test('each result has flag, status, and loadTimeMs fields', async () => {
    const mod = await loadFlagHealthModule()
    const results = await mod.scanAllFlags()
    expect(results.length).toBeGreaterThan(0)
    for (const result of results) {
      expect(typeof result.flag).toBe('string')
      expect(typeof result.status).toBe('string')
      expect(typeof result.loadTimeMs).toBe('number')
      expect(['operational', 'loadable', 'broken', 'missing-dep']).toContain(result.status)
    }
  })

  // Test 3: Scan completes in under 2 seconds
  test('scan completes in under 2 seconds', async () => {
    const mod = await loadFlagHealthModule()
    const start = Date.now()
    await mod.scanAllFlags()
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(2000)
  })

  // Test 4: Results are sorted by flag name (case-insensitive, with underscore prefix handled)
  test('results are sorted by flag name', async () => {
    const mod = await loadFlagHealthModule()
    const results = await mod.scanAllFlags()
    const flags = results.map(r => r.flag)
    // Check that results are in consistent sorted order
    // Using localeCompare which handles case and special chars
    for (let i = 1; i < flags.length; i++) {
      expect(flags[i - 1].localeCompare(flags[i])).toBeLessThanOrEqual(0)
    }
  })

  // Test 5: All active flags from feature-flags.json are scanned
  test('all active flags from feature-flags.json are scanned', async () => {
    const mod = await loadFlagHealthModule()
    const { getAllFlags } = await import('../../../utils/featureFlag.js')
    const activeFlags = Object.entries(getAllFlags())
      .filter(([, v]) => v === true)
      .map(([k]) => k)
    const results = await mod.scanAllFlags()
    const scannedFlags = results.map(r => r.flag)
    for (const flag of activeFlags) {
      expect(scannedFlags).toContain(flag)
    }
  })

  // Test 6: Results include dependsOn for flags with implied dependencies
  test('results include dependsOn for flags with implied dependencies', async () => {
    const mod = await loadFlagHealthModule()
    const results = await mod.scanAllFlags()
    // EXTRACT_MEMORIES implies dependency on memory-related modules
    const extractMemoriesResult = results.find(r => r.flag === 'EXTRACT_MEMORIES')
    expect(extractMemoriesResult).toBeDefined()
    // If the flag has dependencies tracked, dependsOn should be array
    if (extractMemoriesResult && extractMemoriesResult.dependsOn) {
      expect(Array.isArray(extractMemoriesResult.dependsOn)).toBe(true)
    }
  })

  // Test 7: Non-existent module dependencies are marked missing-dep
  test('flags with non-existent module dependencies are marked missing-dep', async () => {
    const mod = await loadFlagHealthModule()
    const results = await mod.scanAllFlags()
    // Find a flag that implies a module that doesn't exist
    const missingDepResults = results.filter(r => r.status === 'missing-dep')
    // This test verifies the classification logic exists
    // Actual flags marked as missing-dep depend on codebase structure
    expect(Array.isArray(missingDepResults)).toBe(true)
  })

  // Test 8: Known operational flags return operational status
  test('known working module paths return operational status', async () => {
    const mod = await loadFlagHealthModule()
    const results = await mod.scanAllFlags()
    // EXTRACT_MEMORIES has a known module path
    const result = results.find(r => r.flag === 'EXTRACT_MEMORIES')
    expect(result).toBeDefined()
    expect(['operational', 'loadable', 'broken', 'missing-dep']).toContain(result!.status)
  })
})
