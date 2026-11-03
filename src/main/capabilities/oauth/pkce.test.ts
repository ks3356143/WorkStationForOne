import { describe, expect, it } from 'vitest'
import { codeChallenge, createCodeVerifier, createState } from './pkce'

describe('PKCE', () => {
  it('S256 固定向量与 RFC 7636 一致', () => {
    expect(codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    )
  })

  it('verifier 与 state 每次不同且是 base64url', () => {
    const a = createCodeVerifier()
    const b = createCodeVerifier()
    const state = createState()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(state).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(a.length).toBeGreaterThanOrEqual(43)
  })
})
