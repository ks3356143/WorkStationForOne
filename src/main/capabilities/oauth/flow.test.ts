import { describe, expect, it, vi } from 'vitest'
import { codeChallenge } from './pkce'
import { loginOAuth, refreshOAuthToken, type ExistingOAuth, type LoginDeps } from './flow'
import type { CallbackResult } from './loopback'
import type { OAuthFetch } from './types'

const RESOURCE = 'https://mcp.example.com/mcp'
const PRM_URL = 'https://mcp.example.com/.well-known/oauth-protected-resource'
const AS_URL = 'https://auth.example.com/.well-known/oauth-authorization-server'
const REGISTER = 'https://auth.example.com/register'
const TOKEN = 'https://auth.example.com/token'

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

function makeFetch(handlers: Record<string, (init?: RequestInit) => Response>): OAuthFetch {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const key = typeof input === 'string' ? input : input.toString()
    const handler = handlers[key]
    if (!handler) throw new Error(`unexpected fetch ${key}`)
    return handler(init)
  }) as unknown as OAuthFetch
}

const PRM = {
  resource: RESOURCE,
  authorization_servers: ['https://auth.example.com'],
  scopes_supported: ['read']
}
const AS = {
  issuer: 'https://auth.example.com',
  authorization_endpoint: 'https://auth.example.com/authorize',
  token_endpoint: TOKEN,
  registration_endpoint: REGISTER,
  code_challenge_methods_supported: ['S256'],
  scopes_supported: ['read']
}

function routes(token: (init?: RequestInit) => Response) {
  return {
    [RESOURCE]: () =>
      json({}, 401, {
        'www-authenticate': `Bearer resource_metadata="${PRM_URL}"`
      }),
    [PRM_URL]: () => json(PRM),
    [AS_URL]: () => json(AS),
    [REGISTER]: () => json({ client_id: 'client-1', token_endpoint_auth_method: 'none' }, 201),
    [TOKEN]: token
  }
}

function deps(except?: Partial<LoginDeps>): {
  deps: LoginDeps
  authorize: () => string
  resolve: (result: CallbackResult) => void
} {
  let authorizeUrl = ''
  let resolveWait: (result: CallbackResult) => void = () => {}
  const wait = new Promise<CallbackResult>((resolve) => {
    resolveWait = resolve
  })
  const base: LoginDeps = {
    fetch: makeFetch({}),
    startCallback: async (ports) => ({
      redirectUri: `http://127.0.0.1:${ports[0]}/oauth/callback`,
      wait,
      close: vi.fn()
    }),
    openExternal: async (url) => {
      authorizeUrl = url
      const state = new URL(url).searchParams.get('state') ?? ''
      resolveWait({ code: 'auth-code', state })
    },
    now: () => 1_700_000_000_000
  }
  return {
    deps: { ...base, ...except },
    authorize: () => authorizeUrl,
    resolve: (result) => resolveWait(result)
  }
}

describe('OAuth 登录', () => {
  it('完成注册、授权、PKCE 校验与 Token 交换', async () => {
    let tokenForm: URLSearchParams | null = null
    const setup = deps()
    const fetchImpl = makeFetch(
      routes((init) => {
        tokenForm = new URLSearchParams(String(init?.body ?? ''))
        return json({
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 3600,
          scope: 'read'
        })
      })
    )
    const result = await loginOAuth({
      resourceUrl: RESOURCE,
      ports: [43110, 43111],
      existing: null,
      deps: { ...setup.deps, fetch: fetchImpl }
    })
    expect(result.registration).toMatchObject({
      clientId: 'client-1',
      issuer: 'https://auth.example.com',
      resource: RESOURCE,
      scopes: 'read'
    })
    expect(result.tokens).toEqual({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: 1_700_003_600_000,
      scope: 'read'
    })

    const authorize = new URL(setup.authorize())
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorize.searchParams.get('resource')).toBe(RESOURCE)
    expect(authorize.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:43110/oauth/callback')
    expect(tokenForm).not.toBeNull()
    expect(codeChallenge(tokenForm!.get('code_verifier')!)).toBe(
      authorize.searchParams.get('code_challenge')
    )
    expect(tokenForm!.get('grant_type')).toBe('authorization_code')
    expect(tokenForm!.get('resource')).toBe(RESOURCE)
  })

  it('state 不匹配时拒绝登录', async () => {
    const setup = deps()
    const fetchImpl = makeFetch(routes(() => json({ access_token: 'x' })))
    await expect(
      loginOAuth({
        resourceUrl: RESOURCE,
        ports: [43110],
        existing: null,
        deps: {
          ...setup.deps,
          fetch: fetchImpl,
          openExternal: async () => {
            setup.resolve({ code: 'auth-code', state: 'wrong-state' })
          }
        }
      })
    ).rejects.toThrow(/state/)
  })

  it('授权服务器不支持 DCR 时给出可读错误', async () => {
    const fetchImpl = makeFetch({
      [RESOURCE]: () =>
        json({}, 401, { 'www-authenticate': `Bearer resource_metadata="${PRM_URL}"` } as never),
      [PRM_URL]: () => json(PRM),
      [AS_URL]: () => json({ ...AS, registration_endpoint: '' })
    })
    await expect(
      loginOAuth({
        resourceUrl: RESOURCE,
        ports: [43110],
        existing: null,
        deps: { ...deps().deps, fetch: fetchImpl }
      })
    ).rejects.toThrow(/预先注册/)
  })
})

describe('OAuth 刷新', () => {
  const registration: ExistingOAuth = {
    clientId: 'client-1',
    clientSecret: null,
    registrationEndpoint: REGISTER,
    tokenEndpoint: TOKEN,
    resource: RESOURCE,
    scopes: 'read',
    authMethod: 'none'
  }

  it('轮换刷新 Token；响应没有 refresh_token 时保留旧值', async () => {
    let form: URLSearchParams | null = null
    const fetchImpl = makeFetch({
      [TOKEN]: (init) => {
        form = new URLSearchParams(String(init?.body ?? ''))
        return json({ access_token: 'access-2', expires_in: 600 })
      }
    })
    const tokens = await refreshOAuthToken({
      registration,
      refreshToken: 'refresh-1',
      deps: { fetch: fetchImpl, now: () => 1_700_000_000_000 }
    })
    expect(tokens).toMatchObject({
      accessToken: 'access-2',
      refreshToken: 'refresh-1',
      expiresAt: 1_700_000_600_000
    })
    expect(form!.get('grant_type')).toBe('refresh_token')
    expect(form!.get('resource')).toBe(RESOURCE)
  })

  it('invalid_grant 提示重新登录', async () => {
    const fetchImpl = makeFetch({
      [TOKEN]: () => json({ error: 'invalid_grant' }, 400)
    })
    await expect(
      refreshOAuthToken({
        registration,
        refreshToken: 'refresh-1',
        deps: { fetch: fetchImpl, now: () => 1 }
      })
    ).rejects.toThrow(/重新登录/)
  })
})
