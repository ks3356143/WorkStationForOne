import { safeStorage } from 'electron'
import type { StoredOAuth } from '../../db/capabilities-rows'
import type { ExistingOAuth } from './flow'

export function encryptSecret(value: string): Buffer {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密不可用，无法保存 OAuth 凭据')
  return safeStorage.encryptString(value)
}

export function decryptSecret(value: Buffer | null): string | null {
  return value ? safeStorage.decryptString(value) : null
}

export function registrationFromStored(stored: StoredOAuth): ExistingOAuth {
  return {
    clientId: stored.clientId,
    clientSecret: decryptSecret(stored.clientSecret),
    registrationEndpoint: stored.registrationEndpoint,
    tokenEndpoint: stored.tokenEndpoint,
    resource: stored.resource,
    scopes: stored.scopes,
    authMethod: stored.authMethod
  }
}

export function accessTokenFromStored(stored: StoredOAuth): string | null {
  return decryptSecret(stored.accessToken)
}

export function refreshTokenFromStored(stored: StoredOAuth): string | null {
  return decryptSecret(stored.refreshToken)
}
