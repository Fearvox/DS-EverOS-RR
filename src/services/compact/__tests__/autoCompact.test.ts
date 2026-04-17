import { describe, test, expect, afterEach } from 'bun:test'
import {
  calculateTokenWarningState,
  getAutoCompactThreshold,
  isAutoCompactEnabled,
} from '../autoCompact.js'

// Use a model with a known context window for deterministic tests
const TEST_MODEL = 'claude-sonnet-4-5-20250514'

describe('autoCompact', () => {
  // Snapshot env before each suite so afterEach restores it correctly
  const savedEnv = { ...process.env }

  afterEach(() => {
    // Restore every env var to its pre-test state
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) {
        delete process.env[key]
      }
    }
    Object.assign(process.env, savedEnv)
  })

  describe('calculateTokenWarningState', () => {
    test('isAboveAutoCompactThreshold is false when tokenUsage is below threshold', () => {
      // Use a small PCT override so threshold is predictable, and ensure autocompact enabled
      delete process.env.DISABLE_AUTO_COMPACT
      delete process.env.DISABLE_COMPACT
      process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = '50'

      const threshold = getAutoCompactThreshold(TEST_MODEL)
      const result = calculateTokenWarningState(threshold - 1, TEST_MODEL)

      expect(result.isAboveAutoCompactThreshold).toBe(false)
    })

    test('isAboveAutoCompactThreshold is true at exactly the threshold', () => {
      delete process.env.DISABLE_AUTO_COMPACT
      delete process.env.DISABLE_COMPACT
      process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = '50'

      const threshold = getAutoCompactThreshold(TEST_MODEL)
      const result = calculateTokenWarningState(threshold, TEST_MODEL)

      expect(result.isAboveAutoCompactThreshold).toBe(true)
    })

    test('isAboveAutoCompactThreshold is true when tokenUsage is above threshold', () => {
      delete process.env.DISABLE_AUTO_COMPACT
      delete process.env.DISABLE_COMPACT
      process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = '50'

      const threshold = getAutoCompactThreshold(TEST_MODEL)
      const result = calculateTokenWarningState(threshold + 1000, TEST_MODEL)

      expect(result.isAboveAutoCompactThreshold).toBe(true)
    })

    test('isAboveAutoCompactThreshold is false when DISABLE_AUTO_COMPACT=1, even far above threshold', () => {
      process.env.DISABLE_AUTO_COMPACT = '1'
      delete process.env.DISABLE_COMPACT
      process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = '50'

      const threshold = getAutoCompactThreshold(TEST_MODEL)
      // Use a value far above threshold
      const result = calculateTokenWarningState(threshold + 10000, TEST_MODEL)

      expect(result.isAboveAutoCompactThreshold).toBe(false)
    })

    test('isAtBlockingLimit is true at CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE value', () => {
      process.env.CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE = '5000'
      delete process.env.DISABLE_AUTO_COMPACT
      delete process.env.DISABLE_COMPACT

      const result = calculateTokenWarningState(5000, TEST_MODEL)

      expect(result.isAtBlockingLimit).toBe(true)
    })

    test('isAtBlockingLimit is false one below CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE', () => {
      process.env.CLAUDE_CODE_BLOCKING_LIMIT_OVERRIDE = '5000'
      delete process.env.DISABLE_AUTO_COMPACT
      delete process.env.DISABLE_COMPACT

      const result = calculateTokenWarningState(4999, TEST_MODEL)

      expect(result.isAtBlockingLimit).toBe(false)
    })

    test('percentLeft is 100 when tokenUsage is 0', () => {
      delete process.env.DISABLE_AUTO_COMPACT
      delete process.env.DISABLE_COMPACT
      process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = '50'

      const result = calculateTokenWarningState(0, TEST_MODEL)

      expect(result.percentLeft).toBe(100)
    })

    test('percentLeft is 0 or 1 when tokenUsage equals the threshold used for percent calculation', () => {
      delete process.env.DISABLE_AUTO_COMPACT
      delete process.env.DISABLE_COMPACT
      process.env.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE = '50'

      const threshold = getAutoCompactThreshold(TEST_MODEL)
      // calculateTokenWarningState uses autoCompactThreshold as the denominator when
      // autocompact is enabled, so tokenUsage === threshold => percentLeft === 0
      const result = calculateTokenWarningState(threshold, TEST_MODEL)

      expect(result.percentLeft).toBeLessThanOrEqual(1)
    })
  })

  describe('isAutoCompactEnabled', () => {
    test('returns false when DISABLE_AUTO_COMPACT=1', () => {
      process.env.DISABLE_AUTO_COMPACT = '1'
      delete process.env.DISABLE_COMPACT

      expect(isAutoCompactEnabled()).toBe(false)
    })

    test('returns false when DISABLE_COMPACT=1', () => {
      process.env.DISABLE_COMPACT = '1'
      delete process.env.DISABLE_AUTO_COMPACT

      expect(isAutoCompactEnabled()).toBe(false)
    })
  })
})
