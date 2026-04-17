import { randomBytes, createCipheriv, createDecipheriv } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12 // 96-bit IV for GCM

/**
 * Encrypt a payload object. Returns: iv:ciphertext:tag (all base64, colon-separated)
 */
export function encryptRelayPayload(payload: object, keyHex: string): string {
  const key = Buffer.from(keyHex, 'hex')
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const plaintext = JSON.stringify(payload)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return [iv.toString('base64'), ciphertext.toString('base64'), tag.toString('base64')].join(':')
}

/**
 * Decrypt a payload encrypted by encryptRelayPayload.
 * @param encrypted  iv:ciphertext:tag string
 * @param keyHex     64-char hex string (32 bytes)
 */
export function decryptRelayPayload(encrypted: string, keyHex: string): object {
  const key = Buffer.from(keyHex, 'hex')
  const [ivB64, ciphertextB64, tagB64] = encrypted.split(':')

  if (!ivB64 || !ciphertextB64 || !tagB64) {
    throw new Error('Invalid encrypted payload format')
  }

  const iv = Buffer.from(ivB64, 'base64')
  const ciphertext = Buffer.from(ciphertextB64, 'base64')
  const tag = Buffer.from(tagB64, 'base64')

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
  return JSON.parse(plaintext)
}
