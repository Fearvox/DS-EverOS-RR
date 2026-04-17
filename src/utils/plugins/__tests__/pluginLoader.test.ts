import { describe, test, expect } from 'bun:test'
import { validateGitUrl } from '../pluginLoader.js'

describe('validateGitUrl', () => {
  test('accepts https:// URLs', () => {
    expect(() => validateGitUrl('https://github.com/example/plugin.git')).not.toThrow()
  })

  test('accepts file:// URLs', () => {
    expect(() => validateGitUrl('file:///local/plugin')).not.toThrow()
  })

  test('accepts git@ SSH URLs', () => {
    expect(() => validateGitUrl('git@github.com:example/plugin.git')).not.toThrow()
  })

  test('rejects http:// URLs', () => {
    expect(() => validateGitUrl('http://github.com/example/plugin.git')).toThrow(
      /Invalid git URL/,
    )
  })

  test('rejects other protocols', () => {
    expect(() => validateGitUrl('ftp://github.com/example/plugin.git')).toThrow(
      /Invalid git URL/,
    )
  })
})
