import { describe, test, expect } from 'bun:test'
import { encryptRelayPayload, decryptRelayPayload } from 'src/utils/crypto'

const TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' // 64 hex chars = 32 bytes
const TEST_PAYLOAD = { messages: [{ role: 'user', content: 'hello' }], model: 'claude-opus-4-6' }

describe('relayCrypto', () => {
  test('encrypt then decrypt returns original payload', () => {
    const encrypted = encryptRelayPayload(TEST_PAYLOAD, TEST_KEY)
    const decrypted = decryptRelayPayload(encrypted, TEST_KEY)
    expect(decrypted).toEqual(TEST_PAYLOAD)
  })

  test('wrong key throws', () => {
    const encrypted = encryptRelayPayload(TEST_PAYLOAD, TEST_KEY)
    const wrongKey = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210'
    expect(() => decryptRelayPayload(encrypted, wrongKey)).toThrow()
  })

  test('tampered ciphertext throws', () => {
    const encrypted = encryptRelayPayload(TEST_PAYLOAD, TEST_KEY)
    const tampered = encrypted.slice(0, -4) + '0000'
    expect(() => decryptRelayPayload(tampered, TEST_KEY)).toThrow()
  })
})
