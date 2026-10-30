import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { migrate, openDatabase } from './db/database'
import { ProviderRepository } from './db/providers'
import { ProviderService } from './providers'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(`enc:${value}`)),
    decryptString: vi.fn((value: Buffer) => value.toString().replace('enc:', ''))
  }
}))

const dirs: string[] = []

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'wsfo-provider-service-'))
  dirs.push(dir)
  const db = openDatabase(join(dir, 'workstation.db'))
  migrate(db)
  return { db, service: new ProviderService(new ProviderRepository(db)) }
}

beforeEach(() => {
  vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true)
})

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

describe('ProviderService', () => {
  it('加密保存 Key，激活后 runtime 返回解密后的配置', () => {
    const { db, service } = setup()
    const saved = service.save({
      name: 'DeepSeek',
      target: 'claude',
      wireApi: 'responses',
      baseUrl: 'http://127.0.0.1:23333',
      model: 'deepseek-v4-flash',
      apiKey: 'sk-test'
    })

    expect(saved).toMatchObject({ active: true, hasToken: true })
    expect(safeStorage.encryptString).toHaveBeenCalledWith('sk-test')
    expect(service.runtime('claude')).toEqual({
      baseUrl: 'http://127.0.0.1:23333',
      model: 'deepseek-v4-flash',
      token: 'sk-test',
      target: 'claude',
      wireApi: 'responses'
    })

    service.setActive('claude', null)
    expect(service.runtime('claude')).toBeUndefined()
    db.close()
  })

  it('编辑时省略 Key 会保留旧 Key', () => {
    const { db, service } = setup()
    const saved = service.save({
      name: 'DeepSeek',
      target: 'claude',
      wireApi: 'responses',
      baseUrl: 'http://127.0.0.1:23333',
      model: 'm',
      apiKey: 'keep'
    })
    service.save({
      id: saved.id,
      name: '改名',
      target: 'claude',
      wireApi: 'responses',
      baseUrl: 'http://127.0.0.1:23333',
      model: 'm2'
    })
    expect(service.runtime('claude')?.token).toBe('keep')
    db.close()
  })

  it('系统加密不可用时拒绝保存 Key', () => {
    const { db, service } = setup()
    vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false)
    expect(() =>
      service.save({
        name: 'x',
        target: 'claude',
        wireApi: 'responses',
        baseUrl: 'http://x',
        model: 'm',
        apiKey: 'secret'
      })
    ).toThrow(/加密/)
    db.close()
  })

  it('旧 Codex Chat 配置按 Responses 运行，避免 CLI 启动即失败', () => {
    const { db, service } = setup()
    service.save({
      name: '旧 Codex',
      target: 'codex',
      wireApi: 'chat',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-flash',
      apiKey: 'old'
    })

    expect(service.runtime('codex')).toMatchObject({ target: 'codex', wireApi: 'responses' })
    db.close()
  })
})
