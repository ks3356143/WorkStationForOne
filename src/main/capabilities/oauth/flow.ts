import { discoverOAuth } from './discovery'
import { CALLBACK_PATH, type CallbackServer } from './loopback'
import { codeChallenge, createCodeVerifier, createState } from './pkce'
import type { OAuthFetch } from './types'

const REQUEST_TIMEOUT = 20_000

export interface OAuthRegistration {
  issuer: string
  resource: string
  clientId: string
  clientSecret: string | null
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint: string
  scopes: string
  authMethod: string
}

export interface OAuthTokenSet {
  accessToken: string
  refreshToken: string | null
  expiresAt: number | null
  scope: string
}

export interface LoginDeps {
  fetch: OAuthFetch
  openExternal: (url: string) => Promise<void>
  startCallback: (ports: number[]) => Promise<CallbackServer>
  now: () => number
}

export interface ExistingOAuth {
  clientId: string
  clientSecret: string | null
  registrationEndpoint: string
  tokenEndpoint: string
  resource: string
  scopes: string
  authMethod: string
}

export interface LoginInput {
  resourceUrl: string
  ports: number[]
  existing: ExistingOAuth | null
  deps: LoginDeps
}

export interface LoginOutput {
  registration: OAuthRegistration
  tokens: OAuthTokenSet
}

function readable(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

async function registerClient(
  input: LoginInput,
  discovery: Awaited<ReturnType<typeof discoverOAuth>>
): Promise<OAuthRegistration> {
  const server = discovery.server
  if (!server.registrationEndpoint) {
    throw new Error('该服务要求预先注册 OAuth 客户端，当前版本暂不支持')
  }
  const redirectUris = input.ports.map((port) => `http://127.0.0.1:${port}${CALLBACK_PATH}`)
  const response = await input.deps.fetch(server.registrationEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'WorkStationForOne',
      redirect_uris: redirectUris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT)
  })
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok || typeof body.client_id !== 'string' || !body.client_id) {
    throw new Error(
      `动态客户端注册失败（${response.status}）${typeof body.error === 'string' ? `：${body.error}` : ''}`
    )
  }
  return {
    issuer: server.issuer,
    resource: discovery.resource.resource,
    clientId: body.client_id,
    clientSecret: typeof body.client_secret === 'string' ? body.client_secret : null,
    authorizationEndpoint: server.authorizationEndpoint,
    tokenEndpoint: server.tokenEndpoint,
    registrationEndpoint: server.registrationEndpoint,
    scopes:
      body.scope && typeof body.scope === 'string'
        ? body.scope
        : discovery.resource.scopesSupported.join(' ') || server.scopesSupported.join(' '),
    authMethod:
      typeof body.token_endpoint_auth_method === 'string'
        ? body.token_endpoint_auth_method
        : server.tokenEndpointAuthMethods.includes('client_secret_post')
          ? 'client_secret_post'
          : 'none'
  }
}

function tokenHeaders(
  registration: ExistingOAuth,
  clientSecret: string | null
): Record<string, string> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (registration.authMethod === 'client_secret_basic') {
    const pair = `${registration.clientId}:${clientSecret ?? ''}`
    headers.authorization = `Basic ${Buffer.from(pair).toString('base64')}`
  }
  return headers
}

async function tokenRequest(
  registration: ExistingOAuth,
  clientSecret: string | null,
  deps: { fetch: OAuthFetch },
  form: Record<string, string>
): Promise<{ status: number; body: Record<string, unknown> }> {
  const body = new URLSearchParams(form)
  if (registration.authMethod !== 'client_secret_basic')
    body.set('client_id', registration.clientId)
  if (registration.authMethod === 'client_secret_post' && clientSecret) {
    body.set('client_secret', clientSecret)
  }
  const response = await deps.fetch(registration.tokenEndpoint, {
    method: 'POST',
    headers: {
      ...tokenHeaders(registration, clientSecret),
      'content-type': 'application/x-www-form-urlencoded'
    },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT)
  })
  return {
    status: response.status,
    body: (await response.json().catch(() => ({}))) as Record<string, unknown>
  }
}

function tokenError(status: number, body: Record<string, unknown>): Error {
  const code = typeof body.error === 'string' ? body.error : ''
  const description = typeof body.error_description === 'string' ? body.error_description : ''
  if (code === 'invalid_grant') return new Error('登录已过期，请重新登录')
  if (code === 'invalid_client') return new Error('OAuth 客户端无效，需要重新登录')
  return new Error(
    `Token 请求失败（${status}）${code ? `：${code}` : ''}${description ? ` ${description}` : ''}`
  )
}

function toTokenSet(
  body: Record<string, unknown>,
  fallbackRefresh: string | null,
  now: number
): OAuthTokenSet {
  if (typeof body.access_token !== 'string' || !body.access_token) {
    throw new Error('Token 响应缺少 access_token')
  }
  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : null
  return {
    accessToken: body.access_token,
    refreshToken:
      typeof body.refresh_token === 'string' && body.refresh_token
        ? body.refresh_token
        : fallbackRefresh,
    expiresAt: expiresIn !== null ? now + expiresIn * 1000 : null,
    scope: typeof body.scope === 'string' ? body.scope : ''
  }
}

export async function loginOAuth(input: LoginInput): Promise<LoginOutput> {
  const discovery = await discoverOAuth({
    resourceUrl: input.resourceUrl,
    fetch: input.deps.fetch
  })
  const existing = input.existing
  const registration =
    existing?.clientId && existing.registrationEndpoint === discovery.server.registrationEndpoint
      ? {
          issuer: discovery.server.issuer,
          resource: discovery.resource.resource,
          clientId: existing.clientId,
          clientSecret: existing.clientSecret,
          authorizationEndpoint: discovery.server.authorizationEndpoint,
          tokenEndpoint: discovery.server.tokenEndpoint,
          registrationEndpoint: discovery.server.registrationEndpoint,
          scopes:
            existing.scopes ||
            discovery.resource.scopesSupported.join(' ') ||
            discovery.server.scopesSupported.join(' '),
          authMethod: existing.authMethod || 'none'
        }
      : await registerClient(input, discovery)

  const callback = await input.deps.startCallback(input.ports)
  try {
    const verifier = createCodeVerifier()
    const state = createState()
    const authorize = new URL(registration.authorizationEndpoint)
    authorize.searchParams.set('response_type', 'code')
    authorize.searchParams.set('client_id', registration.clientId)
    authorize.searchParams.set('redirect_uri', callback.redirectUri)
    if (registration.scopes) authorize.searchParams.set('scope', registration.scopes)
    authorize.searchParams.set('state', state)
    authorize.searchParams.set('code_challenge', codeChallenge(verifier))
    authorize.searchParams.set('code_challenge_method', 'S256')
    authorize.searchParams.set('resource', registration.resource)

    await input.deps.openExternal(authorize.toString())
    const result = await callback.wait
    if (result.error) {
      throw new Error(
        result.error === 'access_denied'
          ? '授权被拒绝'
          : `授权失败：${result.errorDescription || result.error}`
      )
    }
    if (result.state !== state) throw new Error('OAuth 回调 state 不匹配，已拒绝本次登录')
    if (result.iss && result.iss !== discovery.server.issuer) {
      throw new Error('OAuth 回调的签发方与发现结果不一致，已拒绝本次登录')
    }
    if (!result.code) throw new Error('授权回调缺少 code')

    const token = await tokenRequest(registration, registration.clientSecret, input.deps, {
      grant_type: 'authorization_code',
      code: result.code,
      redirect_uri: callback.redirectUri,
      code_verifier: verifier,
      resource: registration.resource
    })
    if (token.status !== 200) throw tokenError(token.status, token.body)
    return {
      registration,
      tokens: toTokenSet(token.body, null, input.deps.now())
    }
  } finally {
    callback.close()
  }
}

export async function refreshOAuthToken(input: {
  registration: ExistingOAuth
  refreshToken: string
  deps: { fetch: OAuthFetch; now: () => number }
}): Promise<OAuthTokenSet> {
  const token = await tokenRequest(
    input.registration,
    input.registration.clientSecret,
    input.deps,
    {
      grant_type: 'refresh_token',
      refresh_token: input.refreshToken,
      resource: input.registration.resource
    }
  )
  if (token.status !== 200) throw tokenError(token.status, token.body)
  return toTokenSet(token.body, input.refreshToken, input.deps.now())
}

export function describeLoginError(error: unknown): string {
  return readable(error, 'OAuth 登录失败')
}
