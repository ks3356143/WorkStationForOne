import { createHash, randomBytes } from 'node:crypto'

const BASE64URL = /\+/g

function base64url(buffer: Buffer): string {
  return buffer.toString('base64').replace(BASE64URL, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function createCodeVerifier(bytes = 32): string {
  return base64url(randomBytes(bytes))
}

export function codeChallenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier, 'utf8').digest())
}

export function createState(bytes = 24): string {
  return base64url(randomBytes(bytes))
}
