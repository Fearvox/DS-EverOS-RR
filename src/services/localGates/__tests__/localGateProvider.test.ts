import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'

// Mock getLocalFlagOverrides at module level — avoids process.env.HOME
// mutation which leaks across parallel test files in Bun.
let mockOverrides: Record<string, unknown> | null = null

mock.module('../../analytics/growthbook.js', () => ({
  getLocalFlagOverrides: () => mockOverrides,
  resetGrowthBook: () => {},
  _resetLocalFlagOverridesForTesting: () => { mockOverrides = null },
}))

type LocalGateModule = typeof import('../localGateProvider.js')

async function loadLocalGateModule(): Promise<LocalGateModule> {
  return import(`../localGateProvider.js?v=${Date.now()}-${Math.random()}`)
}

describe('localGateProvider', () => {
  beforeEach(() => {
    mockOverrides = null
  })

  afterEach(() => {
    mockOverrides = null
  })

  describe('isLocalGate', () => {
    test('returns true for tengu_ prefixed gates', async () => {
      const mod = await loadLocalGateModule()
      expect(mod.isLocalGate('tengu_test_gate')).toBe(true)
      expect(mod.isLocalGate('tengu_model_override')).toBe(true)
      expect(mod.isLocalGate('tengu_1p_event_batch_config')).toBe(true)
    })

    test('returns false for non-tengu_ gates', async () => {
      const mod = await loadLocalGateModule()
      expect(mod.isLocalGate('KAIROS')).toBe(false)
      expect(mod.isLocalGate('PROACTIVE')).toBe(false)
      expect(mod.isLocalGate('some_feature_gate')).toBe(false)
      expect(mod.isLocalGate('normal_gate')).toBe(false)
    })
  })

  describe('getLocalGateValue', () => {
    test('returns value for tengu_key present in feature-flags.json', async () => {
      mockOverrides = { tengu_test_gate: true }
      const mod = await loadLocalGateModule()
      const result = mod.getLocalGateValue('tengu_test_gate')
      expect(result).toBe(true)
    })

    test('returns null for non-tengu_key (not a local gate)', async () => {
      mockOverrides = { tengu_test_gate: true }
      const mod = await loadLocalGateModule()
      const result = mod.getLocalGateValue('KAIROS')
      expect(result).toBeNull()
    })

    test('returns null when feature-flags.json does not exist', async () => {
      mockOverrides = null
      const mod = await loadLocalGateModule()
      const result = mod.getLocalGateValue('tengu_test_gate')
      expect(result).toBeNull()
    })

    test('returns null when feature-flags.json has no tengu_* keys', async () => {
      mockOverrides = {}
      const mod = await loadLocalGateModule()
      const result = mod.getLocalGateValue('tengu_test_gate')
      expect(result).toBeNull()
    })

    test('returns non-boolean values as-is (objects, numbers, strings)', async () => {
      mockOverrides = {
        tengu_config: { key: 'val', nested: true },
        tengu_number: 42,
        tengu_string: 'hello',
      }
      const mod = await loadLocalGateModule()
      expect(mod.getLocalGateValue('tengu_config')).toEqual({ key: 'val', nested: true })
      expect(mod.getLocalGateValue('tengu_number')).toBe(42)
      expect(mod.getLocalGateValue('tengu_string')).toBe('hello')
    })
  })

  describe('resolveGate (local-first priority)', () => {
    test('tengu_* gates resolve from local flags, not remote cache', async () => {
      mockOverrides = { tengu_local_gate: true }
      const mod = await loadLocalGateModule()
      const result = mod.resolveGate('tengu_local_gate')
      expect(result).toEqual({ source: 'local', value: true })
    })

    test('non-tengu_* gates return null (not a local gate)', async () => {
      mockOverrides = { tengu_test: true }
      const mod = await loadLocalGateModule()
      const result = mod.resolveGate('KAIROS')
      expect(result).toBeNull()
    })

    test('resolveGate logs gate resolution with source', async () => {
      mockOverrides = { tengu_logged_gate: true }
      const mod = await loadLocalGateModule()
      const result = mod.resolveGate('tengu_logged_gate')
      expect(result).not.toBeNull()
      expect(result!.source).toBe('local')
      expect(result!.value).toBe(true)
    })
  })
})
