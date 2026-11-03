import type {
  AuthorizationServerMetadata,
  DiscoveryResult,
  OAuthFetch,
  ProtectedResourceMetadata
} from './types'

const MCP_PROTOCOL_VERSION = '2025-06-18'
const DISCOVERY_TIMEOUT = 10_000

function isSecureEndpoint(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol === 'https:') return true
    return url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.length > 0)
    : []
}

async function getJson(deps: { fetch: OAuthFetch }, url: string): Promise<Record<string, unknown>> {
  const response = await deps.fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT)
  })
  if (!response.ok) throw new Error(`读取 OAuth 元数据失败（${response.status}）：${url}`)
  return (await response.json()) as Record<string, unknown>
}

/** 从 WWW-Authenticate 里取 resource_metadata；容忍多余参数与单引号。 */
export function resourceMetadataFromHeader(header: string | null): string {
  if (!header) return ''
  const match = /resource_metadata\s*=\s*["']?([^"',\s]+)["']?/i.exec(header)
  return match?.[1] ?? ''
}

function fallbackResourceMetadata(resourceUrl: string): string {
  const url = new URL(resourceUrl)
  const suffix = url.pathname.replace(/\/+$/, '')
  return `${url.origin}/.well-known/oauth-protected-resource${suffix}`
}

async function probeProtectedResource(
  deps: { fetch: OAuthFetch },
  resourceUrl: string
): Promise<ProtectedResourceMetadata> {
  const response = await deps.fetch(resourceUrl, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': MCP_PROTOCOL_VERSION
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'workstationforone', version: '0.0.0' }
      }
    }),
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT)
  })
  if (response.ok) {
    throw new Error('这个 Server 不要求 OAuth 登录，直接用请求头或匿名连接即可')
  }
  if (response.status !== 401) {
    throw new Error(`MCP Server 返回 ${response.status}，无法开始 OAuth 登录`)
  }
  const url = resourceMetadataFromHeader(response.headers.get('www-authenticate'))
  const metadataUrl = url || fallbackResourceMetadata(resourceUrl)
  const metadata = await getJson(deps, metadataUrl)
  const servers = stringArray(metadata.authorization_servers).filter(isSecureEndpoint)
  if (servers.length === 0) throw new Error('OAuth 元数据里没有 https 授权服务器')
  return {
    resource: typeof metadata.resource === 'string' ? metadata.resource : resourceUrl,
    authorizationServers: servers,
    scopesSupported: stringArray(metadata.scopes_supported)
  }
}

function wellKnownCandidates(issuer: string, suffix: string): string[] {
  const url = new URL(issuer)
  const path = url.pathname.replace(/\/+$/, '')
  return [
    `${url.origin}/.well-known/${suffix}${path}`,
    `${url.origin}/.well-known/${suffix}`,
    `${url.origin}${path}/.well-known/${suffix}`
  ]
}

async function fetchServerMetadata(
  deps: { fetch: OAuthFetch },
  issuer: string
): Promise<Record<string, unknown> | null> {
  for (const suffix of ['oauth-authorization-server', 'openid-configuration']) {
    for (const candidate of wellKnownCandidates(issuer, suffix)) {
      try {
        return await getJson(deps, candidate)
      } catch {
        // 换下一个候选
      }
    }
  }
  return null
}

function toServerMetadata(
  issuer: string,
  raw: Record<string, unknown>
): AuthorizationServerMetadata {
  const authorizationEndpoint =
    typeof raw.authorization_endpoint === 'string' ? raw.authorization_endpoint : ''
  const tokenEndpoint = typeof raw.token_endpoint === 'string' ? raw.token_endpoint : ''
  if (!isSecureEndpoint(authorizationEndpoint) || !isSecureEndpoint(tokenEndpoint)) {
    throw new Error('授权服务器元数据缺少 https 授权端点或 Token 端点')
  }
  const methods = stringArray(raw.code_challenge_methods_supported)
  if (!methods.includes('S256')) throw new Error('授权服务器不支持 PKCE（S256）')
  return {
    issuer: typeof raw.issuer === 'string' && raw.issuer ? raw.issuer : issuer,
    authorizationEndpoint,
    tokenEndpoint,
    registrationEndpoint:
      typeof raw.registration_endpoint === 'string' ? raw.registration_endpoint : '',
    scopesSupported: stringArray(raw.scopes_supported),
    codeChallengeMethods: methods,
    tokenEndpointAuthMethods: stringArray(raw.token_endpoint_auth_methods_supported)
  }
}

/** 401 → 受保护资源元数据 → 授权服务器元数据；任何一步失败都给可读原因。 */
export async function discoverOAuth(input: {
  resourceUrl: string
  fetch: OAuthFetch
}): Promise<DiscoveryResult> {
  const resource = await probeProtectedResource(input, input.resourceUrl)
  let lastError: Error | null = null
  for (const issuer of resource.authorizationServers) {
    const raw = await fetchServerMetadata(input, issuer)
    if (!raw) continue
    try {
      return { resource, server: toServerMetadata(issuer, raw) }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('授权服务器元数据无效')
    }
  }
  throw lastError ?? new Error('找不到授权服务器元数据（/.well-known）')
}
