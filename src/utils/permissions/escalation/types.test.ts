/**
 * Tests for escalation type definitions (Phase 08).
 *
 * Validates:
 * - 'escalation' is a valid PermissionRuleSource (review HIGH #2)
 * - 'escalation' is a valid PermissionUpdateDestination
 * - EscalationGrant uses contextId (not pid) -- review HIGH #1
 * - EscalationGrant, EscalationRequest, EscalationDenial types exist with correct fields
 */

import { describe, it, expect } from 'bun:test'

describe('Escalation types - PermissionRuleSource integration', () => {
  it("'escalation' is a valid PermissionRuleSource", async () => {
    const source = await Bun.file(
      'src/types/permissions.ts',
    ).text()
    // Must appear in PermissionRuleSource union
    expect(source).toContain("'escalation'")
    // Verify it's in the type definition, not just a comment
    const ruleSourceBlock = source.slice(
      source.indexOf('type PermissionRuleSource'),
      source.indexOf('\n\n', source.indexOf('type PermissionRuleSource')),
    )
    expect(ruleSourceBlock).toContain("'escalation'")
  })

  it("'escalation' is a valid PermissionUpdateDestination", async () => {
    const source = await Bun.file(
      'src/types/permissions.ts',
    ).text()
    const destBlock = source.slice(
      source.indexOf('type PermissionUpdateDestination'),
      source.indexOf('\n\n', source.indexOf('type PermissionUpdateDestination')),
    )
    expect(destBlock).toContain("'escalation'")
  })
})

describe('EscalationGrant type', () => {
  it('uses contextId (string), not pid (number)', async () => {
    const source = await Bun.file(
      'src/utils/permissions/escalation/types.ts',
    ).text()
    expect(source).toContain('contextId: string')
    // Verify no 'pid' field in the type definition (comments may reference PID for context)
    expect(source).not.toMatch(/^\s+pid\s*[?:]?\s*:/m)
  })

  it('includes toolName field', async () => {
    const source = await Bun.file(
      'src/utils/permissions/escalation/types.ts',
    ).text()
    expect(source).toContain('toolName: string')
  })

  it('includes optional ruleContent field', async () => {
    const source = await Bun.file(
      'src/utils/permissions/escalation/types.ts',
    ).text()
    expect(source).toContain('ruleContent?: string')
  })

  it('includes grantedAt timestamp', async () => {
    const source = await Bun.file(
      'src/utils/permissions/escalation/types.ts',
    ).text()
    expect(source).toContain('grantedAt: number')
  })

  it('includes reason field', async () => {
    const source = await Bun.file(
      'src/utils/permissions/escalation/types.ts',
    ).text()
    expect(source).toContain('reason: string')
  })

  it('exports EscalationGrant type', async () => {
    const source = await Bun.file(
      'src/utils/permissions/escalation/types.ts',
    ).text()
    expect(source).toContain('export type EscalationGrant')
  })
})

describe('EscalationRequest type', () => {
  it('exports EscalationRequest type', async () => {
    const source = await Bun.file(
      'src/utils/permissions/escalation/types.ts',
    ).text()
    expect(source).toContain('export type EscalationRequest')
  })

  it('includes toolName, reason, and optional riskContext', async () => {
    const source = await Bun.file(
      'src/utils/permissions/escalation/types.ts',
    ).text()
    expect(source).toContain('riskContext?: string')
  })
})

describe('EscalationDenial type', () => {
  it('exports EscalationDenial type', async () => {
    const source = await Bun.file(
      'src/utils/permissions/escalation/types.ts',
    ).text()
    expect(source).toContain('export type EscalationDenial')
  })

  it('includes deniedAt timestamp', async () => {
    const source = await Bun.file(
      'src/utils/permissions/escalation/types.ts',
    ).text()
    expect(source).toContain('deniedAt: number')
  })
})
