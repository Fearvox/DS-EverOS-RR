import { describe, test, expect } from 'bun:test'
import {
  EXTERNAL_PERMISSION_MODES,
  PERMISSION_MODES,
  type PermissionBehavior,
  type PermissionDecision,
  type PermissionResult,
  type PermissionMode,
  type PermissionRule,
} from '../permissions.js'

describe('permission types — runtime shape validation', () => {
  test('EXTERNAL_PERMISSION_MODES contains expected modes', () => {
    expect(EXTERNAL_PERMISSION_MODES).toContain('acceptEdits')
    expect(EXTERNAL_PERMISSION_MODES).toContain('bypassPermissions')
    expect(EXTERNAL_PERMISSION_MODES).toContain('default')
    expect(EXTERNAL_PERMISSION_MODES).toContain('dontAsk')
    expect(EXTERNAL_PERMISSION_MODES).toContain('plan')
  })

  test('PERMISSION_MODES is a superset of EXTERNAL_PERMISSION_MODES', () => {
    for (const mode of EXTERNAL_PERMISSION_MODES) {
      expect(PERMISSION_MODES).toContain(mode)
    }
  })

  test('allow decision has correct shape', () => {
    const decision: PermissionDecision = {
      behavior: 'allow',
      updatedInput: { command: 'ls' },
    }
    expect(decision.behavior).toBe('allow')
  })

  test('deny decision requires message and decisionReason', () => {
    const decision: PermissionDecision = {
      behavior: 'deny',
      message: 'Operation not permitted',
      decisionReason: { type: 'mode', mode: 'default' },
    }
    expect(decision.behavior).toBe('deny')
    expect(decision.message).toBeTruthy()
  })

  test('ask decision requires message', () => {
    const decision: PermissionDecision = {
      behavior: 'ask',
      message: 'Do you want to allow this?',
    }
    expect(decision.behavior).toBe('ask')
    expect(decision.message).toBeTruthy()
  })

  test('passthrough result has correct shape', () => {
    const result: PermissionResult = {
      behavior: 'passthrough',
      message: 'Delegating to parent',
    }
    expect(result.behavior).toBe('passthrough')
  })

  test('PermissionRule carries source and behavior', () => {
    const rule: PermissionRule = {
      source: 'session',
      ruleBehavior: 'allow',
      ruleValue: { toolName: 'BashTool', ruleContent: 'git *' },
    }
    expect(rule.source).toBe('session')
    expect(rule.ruleValue.toolName).toBe('BashTool')
  })
})
