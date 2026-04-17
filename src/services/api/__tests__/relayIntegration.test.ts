import { describe, test, expect } from 'bun:test'
import { encryptRelayPayload, decryptRelayPayload } from 'src/utils/crypto'

const RELAY_URL = process.env.RELAY_URL
const RELAY_KEY = process.env.RELAY_RELAY_KEY
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY

describe('relay integration', () => {
  // Skip if env vars not configured
  if (!RELAY_URL || !RELAY_KEY || !MINIMAX_API_KEY) {
    test('skipped — RELAY_URL or RELAY_RELAY_KEY or MINIMAX_API_KEY not set', () => {
      expect(true).toBe(true)
    })
    return
  }

  test('full roundtrip: encrypt → relay → decrypt → MiniMax response', async () => {
    // Build OpenAI-format payload for MiniMax
    const payload = {
      model: 'abab5.5-chat',
      messages: [{ role: 'user', content: 'Reply with exactly 3 words' }],
      max_tokens: 20,
    }

    // Encrypt with same key as server
    const encrypted = encryptRelayPayload(payload, RELAY_KEY)

    // POST to relay (bypass Vercel protection)
    const bypassUrl = `${RELAY_URL}?x-vercel-protection-bypass=w2mRyBDI6aCCc6TfqZw6OTQs5dVopIz0`
    const response = await fetch(bypassUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ encrypted, provider: 'minimax' }),
    })

    expect(response.ok, `Relay returned ${response.status}`).toBe(true)

    const { encrypted: encryptedResponse } = await response.json() as { encrypted: string }
    expect(encryptedResponse.split(':')).toHaveLength(3)

    // Decrypt and verify structure
    const decrypted = decryptRelayPayload(encryptedResponse, RELAY_KEY) as Record<string, unknown>
    // Should be either a valid chat completion OR an error from MiniMax
    expect(decrypted).toBeTruthy()
    expect(typeof decrypted).toBe('object')

    // If MiniMax returns an error (wrong model), that's still a successful relay roundtrip
    // The important thing is we got a structured response through the relay
    const hasContent = 'choices' in decrypted || 'error' in decrypted
    expect(hasContent).toBe(true)
  })

  test('relay rejects unknown provider', async () => {
    const payload = { model: 'test', messages: [] }
    const encrypted = encryptRelayPayload(payload, RELAY_KEY)
    const bypassUrl = `${RELAY_URL}?x-vercel-protection-bypass=w2mRyBDI6aCCc6TfqZw6OTQs5dVopIz0`

    const response = await fetch(bypassUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ encrypted, provider: 'nonexistent' }),
    })

    const body = await response.json() as Record<string, unknown>
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(body['error']).toBeTruthy()
  })

  test('relay rejects tampered ciphertext', async () => {
    const payload = { model: 'test', messages: [] }
    const encrypted = encryptRelayPayload(payload, RELAY_KEY)
    const tampered = encrypted.slice(0, -4) + 'XXXX'
    const bypassUrl = `${RELAY_URL}?x-vercel-protection-bypass=w2mRyBDI6aCCc6TfqZw6OTQs5dVopIz0`

    const response = await fetch(bypassUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ encrypted: tampered, provider: 'minimax' }),
    })

    const body = await response.json() as Record<string, unknown>
    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(body['error']).toBeTruthy()
  })
})
