import { describe, test, expect, afterEach } from 'bun:test'
import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from 'src/utils/model/providers.js'

describe('getAPIProvider', () => {
  const savedEnv = { ...process.env }

  afterEach(() => {
    // Restore all provider env vars to original state
    for (const key of [
      'CLAUDE_CODE_USE_BEDROCK',
      'CLAUDE_CODE_USE_VERTEX',
      'CLAUDE_CODE_USE_FOUNDRY',
    ]) {
      if (savedEnv[key] !== undefined) {
        process.env[key] = savedEnv[key]
      } else {
        delete process.env[key]
      }
    }
  })

  test('returns firstParty when no provider env vars are set', () => {
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
    expect(getAPIProvider()).toBe('firstParty')
  })

  test('returns bedrock when CLAUDE_CODE_USE_BEDROCK=1', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
    expect(getAPIProvider()).toBe('bedrock')
  })

  test('returns vertex when CLAUDE_CODE_USE_VERTEX=1', () => {
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    process.env.CLAUDE_CODE_USE_VERTEX = '1'
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
    expect(getAPIProvider()).toBe('vertex')
  })

  test('returns foundry when CLAUDE_CODE_USE_FOUNDRY=1', () => {
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    process.env.CLAUDE_CODE_USE_FOUNDRY = '1'
    expect(getAPIProvider()).toBe('foundry')
  })

  test('bedrock takes precedence over vertex when both are set', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    process.env.CLAUDE_CODE_USE_VERTEX = '1'
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
    expect(getAPIProvider()).toBe('bedrock')
  })

  test('bedrock takes precedence over foundry when both are set', () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    delete process.env.CLAUDE_CODE_USE_VERTEX
    process.env.CLAUDE_CODE_USE_FOUNDRY = '1'
    expect(getAPIProvider()).toBe('bedrock')
  })

  test('vertex takes precedence over foundry when both are set', () => {
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    process.env.CLAUDE_CODE_USE_VERTEX = '1'
    process.env.CLAUDE_CODE_USE_FOUNDRY = '1'
    expect(getAPIProvider()).toBe('vertex')
  })
})

describe('isFirstPartyAnthropicBaseUrl', () => {
  const savedBaseUrl = process.env.ANTHROPIC_BASE_URL
  const savedUserType = process.env.USER_TYPE

  afterEach(() => {
    if (savedBaseUrl !== undefined) {
      process.env.ANTHROPIC_BASE_URL = savedBaseUrl
    } else {
      delete process.env.ANTHROPIC_BASE_URL
    }
    if (savedUserType !== undefined) {
      process.env.USER_TYPE = savedUserType
    } else {
      delete process.env.USER_TYPE
    }
  })

  test('returns true when ANTHROPIC_BASE_URL is not set', () => {
    delete process.env.ANTHROPIC_BASE_URL
    expect(isFirstPartyAnthropicBaseUrl()).toBe(true)
  })

  test('returns true for https://api.anthropic.com', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com'
    expect(isFirstPartyAnthropicBaseUrl()).toBe(true)
  })

  test('returns true for https://api.anthropic.com/v1', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api.anthropic.com/v1'
    expect(isFirstPartyAnthropicBaseUrl()).toBe(true)
  })

  test('returns false for custom proxy URLs', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://my-proxy.example.com'
    expect(isFirstPartyAnthropicBaseUrl()).toBe(false)
  })

  test('returns false for invalid URLs', () => {
    process.env.ANTHROPIC_BASE_URL = 'not-a-url'
    expect(isFirstPartyAnthropicBaseUrl()).toBe(false)
  })

  test('returns true for api-staging.anthropic.com when USER_TYPE is ant', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api-staging.anthropic.com'
    process.env.USER_TYPE = 'ant'
    expect(isFirstPartyAnthropicBaseUrl()).toBe(true)
  })

  test('returns false for api-staging.anthropic.com when USER_TYPE is not ant', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://api-staging.anthropic.com'
    process.env.USER_TYPE = 'external'
    expect(isFirstPartyAnthropicBaseUrl()).toBe(false)
  })
})
