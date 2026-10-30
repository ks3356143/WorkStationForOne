import { safeStorage } from 'electron'
import type {
  ProviderProfileRecord,
  ProviderSaveInput,
  ProviderTarget,
  ProviderTestInput,
  ProviderTestResult,
  ProviderWireApi
} from '../shared/ipc'
import type { ProviderRepository } from './db/providers'
import { testProviderConnection } from './provider-connection'

export interface ProviderRuntime {
  baseUrl: string
  model: string
  token: string
  target: ProviderTarget
  wireApi: ProviderWireApi
}

export class ProviderService {
  constructor(private readonly repository: ProviderRepository) {}

  list(): ProviderProfileRecord[] {
    return this.repository.list()
  }

  save(input: ProviderSaveInput): ProviderProfileRecord {
    let token: Buffer | undefined
    if (input.apiKey) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('系统加密不可用，无法安全保存 API Key')
      }
      token = safeStorage.encryptString(input.apiKey)
    }
    const saved = this.repository.save(input, token)
    this.repository.setActive(saved.target, saved.id)
    return { ...saved, active: true }
  }

  setActive(target: ProviderTarget, id: string | null): void {
    this.repository.setActive(target, id)
  }

  async testConnection(input: ProviderTestInput): Promise<ProviderTestResult> {
    let token = input.apiKey?.trim()
    if (!token && input.id) {
      if (!safeStorage.isEncryptionAvailable()) {
        return { ok: false, latencyMs: 0, message: '系统加密不可用，无法读取 Provider API Key' }
      }
      const encrypted = this.repository.secretFor(input.id, input.target)
      if (encrypted) token = safeStorage.decryptString(encrypted)
    }
    if (!token) {
      return { ok: false, latencyMs: 0, message: '没有可用的 API Key，请先填写' }
    }
    return testProviderConnection({
      target: input.target,
      wireApi: input.wireApi,
      baseUrl: input.baseUrl,
      model: input.model,
      token
    })
  }

  /** 自定义 provider 的运行时配置；没有激活配置时返回 undefined（继承 CLI）。 */
  runtime(target: ProviderTarget): ProviderRuntime | undefined {
    const active = this.repository.activeSecret(target)
    if (!active) return undefined
    if (!active.token) {
      throw new Error('Provider 缺少 API Key，请先在设置中填写')
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('系统加密不可用，无法读取 Provider API Key')
    }
    return {
      baseUrl: active.profile.baseUrl,
      model: active.profile.model,
      token: safeStorage.decryptString(active.token),
      target: active.profile.target,
      // Codex CLI 0.166 起移除了 Chat，历史 chat 配置按 Responses 运行。
      wireApi: active.profile.target === 'codex' ? 'responses' : active.profile.wireApi
    }
  }
}
