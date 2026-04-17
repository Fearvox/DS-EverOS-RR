import { describe, test, expect } from 'bun:test'
import { validateUuid, createAgentId } from './uuid.js'

describe('validateUuid', () => {
  test('accepts valid lowercase UUID', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000'
    expect(validateUuid(uuid)).toBe(uuid)
  })

  test('accepts valid uppercase UUID', () => {
    const uuid = '550E8400-E29B-41D4-A716-446655440000'
    expect(validateUuid(uuid)).toBe(uuid)
  })

  test('accepts valid mixed case UUID', () => {
    const uuid = '550e8400-E29B-41d4-a716-446655440000'
    expect(validateUuid(uuid)).toBe(uuid)
  })

  test('rejects non-string values', () => {
    expect(validateUuid(123)).toBeNull()
    expect(validateUuid(null)).toBeNull()
    expect(validateUuid(undefined)).toBeNull()
    expect(validateUuid({})).toBeNull()
    expect(validateUuid([])).toBeNull()
  })

  test('rejects empty string', () => {
    expect(validateUuid('')).toBeNull()
  })

  test('rejects malformed UUID', () => {
    expect(validateUuid('not-a-uuid')).toBeNull()
    expect(validateUuid('550e8400-e29b-41d4-a716')).toBeNull()
    expect(validateUuid('550e8400e29b41d4a716446655440000')).toBeNull()
  })

  test('rejects UUID with invalid characters', () => {
    expect(validateUuid('550e8400-e29b-41d4-a716-44665544000g')).toBeNull()
  })
})

describe('createAgentId', () => {
  test('returns string starting with "a"', () => {
    const id = createAgentId()
    expect(id.startsWith('a')).toBe(true)
  })

  test('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => createAgentId()))
    expect(ids.size).toBe(100)
  })

  test('includes label when provided', () => {
    const id = createAgentId('compact')
    expect(id.startsWith('acompact-')).toBe(true)
  })

  test('has correct format without label', () => {
    const id = createAgentId()
    // Format: a{16 hex chars}
    expect(id).toMatch(/^a[0-9a-f]{16}$/)
  })

  test('has correct format with label', () => {
    const id = createAgentId('test')
    // Format: a{label}-{16 hex chars}
    expect(id).toMatch(/^atest-[0-9a-f]{16}$/)
  })
})
