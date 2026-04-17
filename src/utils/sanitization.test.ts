import { describe, test, expect } from 'bun:test'
import {
  partiallySanitizeUnicode,
  recursivelySanitizeUnicode,
} from './sanitization.js'

describe('partiallySanitizeUnicode', () => {
  test('leaves normal ASCII text unchanged', () => {
    expect(partiallySanitizeUnicode('hello world')).toBe('hello world')
  })

  test('leaves common Unicode (CJK, emoji) unchanged', () => {
    expect(partiallySanitizeUnicode('你好世界')).toBe('你好世界')
    expect(partiallySanitizeUnicode('café')).toBe('café')
  })

  test('strips zero-width spaces', () => {
    expect(partiallySanitizeUnicode('he\u200Bllo')).toBe('hello')
  })

  test('strips directional formatting characters', () => {
    expect(partiallySanitizeUnicode('ab\u202Acd\u202Eef')).toBe('abcdef')
  })

  test('strips directional isolates', () => {
    expect(partiallySanitizeUnicode('a\u2066b\u2069c')).toBe('abc')
  })

  test('strips byte order mark', () => {
    expect(partiallySanitizeUnicode('\uFEFFhello')).toBe('hello')
  })

  test('strips BMP private use area characters', () => {
    expect(partiallySanitizeUnicode('a\uE000b\uF8FFc')).toBe('abc')
  })

  test('strips LTR/RTL marks', () => {
    expect(partiallySanitizeUnicode('a\u200Eb\u200Fc')).toBe('abc')
  })

  test('handles empty string', () => {
    expect(partiallySanitizeUnicode('')).toBe('')
  })

  test('handles string with only dangerous characters', () => {
    expect(partiallySanitizeUnicode('\u200B\u200C\u200D\uFEFF')).toBe('')
  })

  test('applies NFKC normalization', () => {
    // ﬁ (U+FB01) normalizes to "fi" under NFKC
    expect(partiallySanitizeUnicode('\uFB01')).toBe('fi')
  })
})

describe('recursivelySanitizeUnicode', () => {
  test('sanitizes strings', () => {
    expect(recursivelySanitizeUnicode('he\u200Bllo')).toBe('hello')
  })

  test('sanitizes arrays of strings', () => {
    expect(recursivelySanitizeUnicode(['he\u200Bllo', 'wo\uFEFFrld'])).toEqual([
      'hello',
      'world',
    ])
  })

  test('sanitizes object values', () => {
    expect(
      recursivelySanitizeUnicode({ name: 'he\u200Bllo', count: 42 }),
    ).toEqual({ name: 'hello', count: 42 })
  })

  test('sanitizes object keys', () => {
    expect(
      recursivelySanitizeUnicode({ 'ke\u200By': 'value' }),
    ).toEqual({ key: 'value' })
  })

  test('sanitizes nested structures', () => {
    const input = {
      items: [{ text: 'he\u200Bllo' }],
      meta: { tag: 'wo\uFEFFrld' },
    }
    expect(recursivelySanitizeUnicode(input)).toEqual({
      items: [{ text: 'hello' }],
      meta: { tag: 'world' },
    })
  })

  test('passes through numbers unchanged', () => {
    expect(recursivelySanitizeUnicode(42)).toBe(42)
  })

  test('passes through booleans unchanged', () => {
    expect(recursivelySanitizeUnicode(true)).toBe(true)
  })

  test('passes through null unchanged', () => {
    expect(recursivelySanitizeUnicode(null)).toBeNull()
  })

  test('passes through undefined unchanged', () => {
    expect(recursivelySanitizeUnicode(undefined)).toBeUndefined()
  })
})
