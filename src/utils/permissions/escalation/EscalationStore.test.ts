/**
 * Unit tests for EscalationStore (Phase 08).
 *
 * Validates:
 * - Context-ID scoped grant/check/revoke (review HIGH #1)
 * - Forked agent isolation (different agentId gets false)
 * - Wildcard fallback for ruleContent granularity (review MEDIUM #6)
 * - Denied request tracking (prevents re-prompting)
 * - No disk I/O imports (PERM-05 compliance)
 * - Test isolation via _resetForTesting
 */

import { describe, it, expect, beforeEach } from 'bun:test'
import {
  registerMainSessionContext,
  grantEscalation,
  hasEscalation,
  getEscalationForTool,
  getActiveGrants,
  revokeAllEscalations,
  recordDeniedEscalation,
  wasEscalationDenied,
  grantKey,
  _resetForTesting,
} from './EscalationStore.js'
import type { EscalationGrant } from './types.js'

const MAIN_CTX = 'main-session-001'
const FORKED_CTX = 'forked-agent-123'

function makeGrant(overrides: Partial<EscalationGrant> = {}): EscalationGrant {
  return {
    contextId: MAIN_CTX,
    toolName: 'Bash',
    reason: 'Need to run npm publish',
    grantedAt: Date.now(),
    ...overrides,
  }
}

describe('EscalationStore', () => {
  beforeEach(() => {
    _resetForTesting()
    registerMainSessionContext(MAIN_CTX)
  })

  // ── registerMainSessionContext ──────────────────────────────

  describe('registerMainSessionContext', () => {
    it('stores the main context ID', () => {
      // Already registered in beforeEach; granting should work
      const grant = makeGrant()
      expect(() => grantEscalation(grant)).not.toThrow()
    })

    it('re-registering overwrites the previous context ID', () => {
      const newCtx = 'new-session-999'
      registerMainSessionContext(newCtx)
      // Old context ID should now be rejected
      const grant = makeGrant({ contextId: MAIN_CTX })
      expect(() => grantEscalation(grant)).toThrow('context ID mismatch')
      // New context ID should work
      const newGrant = makeGrant({ contextId: newCtx })
      expect(() => grantEscalation(newGrant)).not.toThrow()
    })
  })

  // ── grantKey ───────────────────────────────────────────────

  describe('grantKey', () => {
    it('produces contextId:toolName:* for no ruleContent', () => {
      expect(grantKey(MAIN_CTX, 'Bash')).toBe(`${MAIN_CTX}:Bash:*`)
    })

    it('produces contextId:toolName:ruleContent for given ruleContent', () => {
      expect(grantKey(MAIN_CTX, 'Bash', 'npm publish:*')).toBe(
        `${MAIN_CTX}:Bash:npm publish:*`,
      )
    })

    it('two different ruleContent values produce different keys', () => {
      const key1 = grantKey(MAIN_CTX, 'Bash', 'npm publish:*')
      const key2 = grantKey(MAIN_CTX, 'Bash', 'rm -rf:*')
      expect(key1).not.toBe(key2)
    })
  })

  // ── grantEscalation ────────────────────────────────────────

  describe('grantEscalation', () => {
    it('stores grant for registered main session context', () => {
      const grant = makeGrant()
      grantEscalation(grant)
      expect(hasEscalation(MAIN_CTX, 'Bash')).toBe(true)
    })

    it('throws on context ID mismatch', () => {
      const grant = makeGrant({ contextId: FORKED_CTX })
      expect(() => grantEscalation(grant)).toThrow('context ID mismatch')
    })

    it('throws when no main session context registered', () => {
      _resetForTesting() // Clear registered context
      const grant = makeGrant()
      expect(() => grantEscalation(grant)).toThrow(
        'No main session context registered',
      )
    })

    it('multiple grants for different tools coexist', () => {
      grantEscalation(makeGrant({ toolName: 'Bash' }))
      grantEscalation(makeGrant({ toolName: 'FileEdit' }))
      expect(hasEscalation(MAIN_CTX, 'Bash')).toBe(true)
      expect(hasEscalation(MAIN_CTX, 'FileEdit')).toBe(true)
    })
  })

  // ── hasEscalation ──────────────────────────────────────────

  describe('hasEscalation', () => {
    it('returns true for correct contextId + granted tool', () => {
      grantEscalation(makeGrant())
      expect(hasEscalation(MAIN_CTX, 'Bash')).toBe(true)
    })

    it('returns false for different contextId (simulates forked agent)', () => {
      grantEscalation(makeGrant())
      expect(hasEscalation(FORKED_CTX, 'Bash')).toBe(false)
    })

    it('returns false for non-granted tool', () => {
      grantEscalation(makeGrant({ toolName: 'Bash' }))
      expect(hasEscalation(MAIN_CTX, 'GrepTool')).toBe(false)
    })

    it('returns false after revokeAllEscalations', () => {
      grantEscalation(makeGrant())
      revokeAllEscalations()
      expect(hasEscalation(MAIN_CTX, 'Bash')).toBe(false)
    })

    it('distinguishes by ruleContent', () => {
      grantEscalation(makeGrant({ ruleContent: 'npm publish:*' }))
      expect(hasEscalation(MAIN_CTX, 'Bash', 'npm publish:*')).toBe(true)
      expect(hasEscalation(MAIN_CTX, 'Bash', 'rm -rf:*')).toBe(false)
    })

    it('wildcard fallback: tool granted without ruleContent matches any ruleContent query', () => {
      grantEscalation(makeGrant()) // No ruleContent = wildcard
      expect(hasEscalation(MAIN_CTX, 'Bash', 'npm publish:*')).toBe(true)
      expect(hasEscalation(MAIN_CTX, 'Bash', 'anything')).toBe(true)
    })
  })

  // ── getEscalationForTool ───────────────────────────────────

  describe('getEscalationForTool', () => {
    it('returns EscalationGrant object for correct contextId + granted tool', () => {
      const grant = makeGrant()
      grantEscalation(grant)
      const result = getEscalationForTool(MAIN_CTX, 'Bash')
      expect(result).toBeDefined()
      expect(result!.contextId).toBe(MAIN_CTX)
      expect(result!.toolName).toBe('Bash')
      expect(result!.reason).toBe('Need to run npm publish')
    })

    it('returns undefined for different contextId', () => {
      grantEscalation(makeGrant())
      expect(getEscalationForTool(FORKED_CTX, 'Bash')).toBeUndefined()
    })

    it('returns undefined for non-granted tool', () => {
      grantEscalation(makeGrant())
      expect(getEscalationForTool(MAIN_CTX, 'GrepTool')).toBeUndefined()
    })

    it('returned grant has correct contextId, toolName, reason fields', () => {
      const grant = makeGrant({ reason: 'specific reason here' })
      grantEscalation(grant)
      const result = getEscalationForTool(MAIN_CTX, 'Bash')
      expect(result).toMatchObject({
        contextId: MAIN_CTX,
        toolName: 'Bash',
        reason: 'specific reason here',
      })
    })
  })

  // ── getActiveGrants ────────────────────────────────────────

  describe('getActiveGrants', () => {
    it('returns empty map when no grants', () => {
      const grants = getActiveGrants(MAIN_CTX)
      expect(grants.size).toBe(0)
    })

    it('returns all grants for given contextId', () => {
      grantEscalation(makeGrant({ toolName: 'Bash' }))
      grantEscalation(makeGrant({ toolName: 'FileEdit' }))
      const grants = getActiveGrants(MAIN_CTX)
      expect(grants.size).toBe(2)
    })

    it('does not return grants for other contextIds', () => {
      grantEscalation(makeGrant())
      // Forked agent querying should get empty
      const grants = getActiveGrants(FORKED_CTX)
      expect(grants.size).toBe(0)
    })
  })

  // ── revokeAllEscalations ───────────────────────────────────

  describe('revokeAllEscalations', () => {
    it('clears all grants', () => {
      grantEscalation(makeGrant({ toolName: 'Bash' }))
      grantEscalation(makeGrant({ toolName: 'FileEdit' }))
      revokeAllEscalations()
      expect(getActiveGrants(MAIN_CTX).size).toBe(0)
    })

    it('clears denied requests', () => {
      recordDeniedEscalation('Bash')
      expect(wasEscalationDenied('Bash')).toBe(true)
      revokeAllEscalations()
      expect(wasEscalationDenied('Bash')).toBe(false)
    })

    it('hasEscalation returns false for previously granted tools', () => {
      grantEscalation(makeGrant())
      revokeAllEscalations()
      expect(hasEscalation(MAIN_CTX, 'Bash')).toBe(false)
    })
  })

  // ── denied request tracking ────────────────────────────────

  describe('denied request tracking', () => {
    it('recordDeniedEscalation records denial', () => {
      recordDeniedEscalation('Bash')
      expect(wasEscalationDenied('Bash')).toBe(true)
    })

    it('wasEscalationDenied returns true after denial', () => {
      recordDeniedEscalation('Bash', 'npm publish:*')
      expect(wasEscalationDenied('Bash', 'npm publish:*')).toBe(true)
    })

    it('wasEscalationDenied returns false for non-denied tool', () => {
      recordDeniedEscalation('Bash')
      expect(wasEscalationDenied('FileEdit')).toBe(false)
    })

    it('revokeAllEscalations clears denials', () => {
      recordDeniedEscalation('Bash')
      revokeAllEscalations()
      expect(wasEscalationDenied('Bash')).toBe(false)
    })
  })

  // ── PERM-05 compliance ─────────────────────────────────────

  describe('PERM-05 compliance', () => {
    it('no disk I/O imports in EscalationStore.ts', async () => {
      const source = await Bun.file(
        'src/utils/permissions/escalation/EscalationStore.ts',
      ).text()
      const forbidden = [
        'writeFile',
        'writeFileSync',
        'settings',
        'localStorage',
        'persistPermission',
      ]
      for (const word of forbidden) {
        expect(source).not.toContain(word)
      }
    })

    it('no process.pid references in EscalationStore.ts', async () => {
      const source = await Bun.file(
        'src/utils/permissions/escalation/EscalationStore.ts',
      ).text()
      expect(source).not.toContain('process.pid')
    })
  })

  // ── test isolation ─────────────────────────────────────────

  describe('test isolation', () => {
    it('_resetForTesting clears all state including registered context', () => {
      grantEscalation(makeGrant())
      recordDeniedEscalation('FileEdit')
      _resetForTesting()
      // No registered context -- grant should throw
      expect(() => grantEscalation(makeGrant())).toThrow(
        'No main session context registered',
      )
      expect(wasEscalationDenied('FileEdit')).toBe(false)
    })

    it('grants from one test do not leak into another', () => {
      // This test runs after beforeEach which calls _resetForTesting
      // If prior test leaked state, this would fail
      expect(hasEscalation(MAIN_CTX, 'Bash')).toBe(false)
      expect(getActiveGrants(MAIN_CTX).size).toBe(0)
    })
  })
})
