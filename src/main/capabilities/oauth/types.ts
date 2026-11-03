export interface ProtectedResourceMetadata {
  resource: string
  authorizationServers: string[]
  scopesSupported: string[]
}

export interface AuthorizationServerMetadata {
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint: string
  scopesSupported: string[]
  codeChallengeMethods: string[]
  tokenEndpointAuthMethods: string[]
}

export interface DiscoveryResult {
  resource: ProtectedResourceMetadata
  server: AuthorizationServerMetadata
}

export type OAuthFetch = (input: string, init?: RequestInit) => Promise<Response>
