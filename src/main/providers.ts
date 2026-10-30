import { safeStorage } from 'electron'
import type {
  ProviderProfileRecord,
  ProviderSaveInput,
  ProviderTarget,
  ProviderWireApi
} from '../shared/ipc'
import type { ProviderRepository } from './db/providers'

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
      wireApi: active.profile.wireApi
    }
  }
}
