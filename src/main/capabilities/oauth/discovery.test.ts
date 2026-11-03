import { describe, expect, it, vi } from 'vitest'
import { discoverOAuth, resourceMetadataFromHeader } from './discovery'
import type { OAuthFetch } from './types'

const RESOURCE = 'https://mcp.example.com/mcp'
const PRM_URL = 'https://mcp.example.com/.well-known/oauth-protected-resource'
const AS_URL = 'https://auth.example.com/.well-known/oauth-authorization-server'

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

const PRM = {
  resource: RESOURCE,
  authorization_servers: ['https://auth.example.com'],
  scopes_supported: ['read', 'write']
}

const AS = {
  issuer: 'https://auth.example.com',
  authorization_endpoint: 'https://auth.example.com/authorize',
  token_endpoint: 'https://auth.example.com/token',
  registration_endpoint: 'https://auth.example.com/register',
  code_challenge_methods_supported: ['S256'],
  scopes_supported: ['read']
}

function routeFetch(routes: Record<string, () => Response>): OAuthFetch {
  return vi.fn(async (input: string | URL | Request) => {
    const key = typeof input === 'string' ? input : input.toString()
    const route = routes[key]
    if (!route) throw new Error(`unexpected fetch ${key}`)
    return route()
  }) as unknown as OAuthFetch
}

describe('OAuth 发现', () => {
  it('从 401 的 WWW-Authenticate 找到资源元数据与授权服务器', async () => {
    const fetchImpl = routeFetch({
      [RESOURCE]: () =>
        json({}, 401, {
          'www-authenticate':
            'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource", scope="read"'
        }),
      [PRM_URL]: () => json(PRM),
      [AS_URL]: () => json(AS)
    })
    const result = await discoverOAuth({ resourceUrl: RESOURCE, fetch: fetchImpl })
    expect(result.resource.authorizationServers).toEqual(['https://auth.example.com'])
    expect(result.server).toMatchObject({
      issuer: 'https://auth.example.com',
      tokenEndpoint: 'https://auth.example.com/token',
      registrationEndpoint: 'https://auth.example.com/register'
    })
    expect(result.server.codeChallengeMethods).toContain('S256')
  })

  it('没有 WWW-Authenticate 时回退到 well-known', async () => {
    const fetchImpl = routeFetch({
      [RESOURCE]: () => json({}, 401),
      [`${PRM_URL}/mcp`]: () => json(PRM),
      [AS_URL]: () => json(AS)
    })
    const result = await discoverOAuth({ resourceUrl: RESOURCE, fetch: fetchImpl })
    expect(result.server.authorizationEndpoint).toBe('https://auth.example.com/authorize')
  })

  it('授权服务器不支持 S256 时拒绝', async () => {
    const fetchImpl = routeFetch({
      [RESOURCE]: () =>
        json({}, 401, { 'www-authenticate': `Bearer resource_metadata="${PRM_URL}"` }),
      [PRM_URL]: () => json(PRM),
      [AS_URL]: () => json({ ...AS, code_challenge_methods_supported: ['plain'] })
    })
    await expect(discoverOAuth({ resourceUrl: RESOURCE, fetch: fetchImpl })).rejects.toThrow(/PKCE/)
  })

  it('允许本机回环 http 授权端点，拒绝公网 http', async () => {
    const fetchImpl = routeFetch({
      [RESOURCE]: () =>
        json({}, 401, { 'www-authenticate': `Bearer resource_metadata="${PRM_URL}"` }),
      [PRM_URL]: () => json({ ...PRM, authorization_servers: ['http://127.0.0.1:43110'] }),
      'http://127.0.0.1:43110/.well-known/oauth-authorization-server': () =>
        json({
          ...AS,
          issuer: 'http://127.0.0.1:43110',
          authorization_endpoint: 'http://127.0.0.1:43110/authorize',
          token_endpoint: 'http://127.0.0.1:43110/token'
        })
    })
    const result = await discoverOAuth({ resourceUrl: RESOURCE, fetch: fetchImpl })
    expect(result.server.issuer).toBe('http://127.0.0.1:43110')

    const publicHttp = routeFetch({
      [RESOURCE]: () =>
        json({}, 401, { 'www-authenticate': `Bearer resource_metadata="${PRM_URL}"` }),
      [PRM_URL]: () => json({ ...PRM, authorization_servers: ['http://auth.example.com'] })
    })
    await expect(discoverOAuth({ resourceUrl: RESOURCE, fetch: publicHttp })).rejects.toThrow()
  })

  it('Server 不要求鉴权时给出明确说明', async () => {
    const fetchImpl = routeFetch({ [RESOURCE]: () => json({ result: {} }) })
    await expect(discoverOAuth({ resourceUrl: RESOURCE, fetch: fetchImpl })).rejects.toThrow(
      /不要求 OAuth/
    )
  })

  it('解析带引号与单引号的 resource_metadata', () => {
    expect(resourceMetadataFromHeader('Bearer resource_metadata="https://a/b"')).toBe('https://a/b')
    expect(resourceMetadataFromHeader("Bearer resource_metadata='https://a/c', scope=x")).toBe(
      'https://a/c'
    )
    expect(resourceMetadataFromHeader('Bearer error="invalid_token"')).toBe('')
  })
})
