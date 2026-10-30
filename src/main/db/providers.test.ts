import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS, migrate, openDatabase, userVersion } from './database'
import { ProviderRepository } from './providers'

const dirs: string[] = []

function seedDb() {
  const dir = mkdtempSync(join(tmpdir(), 'wsfo-provider-'))
  dirs.push(dir)
  const db = openDatabase(join(dir, 'workstation.db'))
  migrate(db)
  return { db, repo: new ProviderRepository(db) }
}

afterEach(() => {
  while (dirs.length) {
    rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

const profile = {
  name: 'DeepSeek 代理',
  target: 'claude' as const,
  wireApi: 'responses' as const,
  baseUrl: 'http://127.0.0.1:23333',
  model: 'deepseek-v4-flash'
}

describe('迁移 v17', () => {
  it('建立 provider_profiles 表并推进到最新版本', () => {
    const { db } = seedDb()
    expect(userVersion(db)).toBe(MIGRATIONS.at(-1)!.version)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'provider_profiles'")
      .all()
    expect(tables).toHaveLength(1)
    db.close()
  })
})

describe('ProviderRepository', () => {
  it('保存配置与加密 token，列表不回传 token', () => {
    const { db, repo } = seedDb()
    const token = Buffer.from('encrypted-token')
    const saved = repo.save(profile, token)

    expect(saved).toMatchObject({ ...profile, hasToken: true, active: false })
    const list = repo.list()
    expect(list).toHaveLength(1)
    expect(list[0]).not.toHaveProperty('token')
    const secret = repo.activeSecret('claude')
    expect(secret).toBeUndefined()
    db.close()
  })

  it('激活配置后 runtime 能拿到 token，且同一时间只有一个 active', () => {
    const { db, repo } = seedDb()
    const first = repo.save(profile, Buffer.from('token-1'))
    const second = repo.save({ ...profile, name: '第二个' }, Buffer.from('token-2'))
    repo.setActive('claude', first.id)

    expect(
      repo
        .list()
        .filter((item) => item.active)
        .map((item) => item.id)
    ).toEqual([first.id])
    expect(repo.activeSecret('claude')).toMatchObject({
      profile: { id: first.id, name: profile.name },
      token: Buffer.from('token-1')
    })

    repo.setActive('claude', second.id)
    expect(repo.activeSecret('claude')?.profile.id).toBe(second.id)
    repo.setActive('claude', null)
    expect(repo.activeSecret('claude')).toBeUndefined()
    db.close()
  })

  it('Claude 与 Codex 各自一个 active，互不影响', () => {
    const { db, repo } = seedDb()
    const claude = repo.save(profile, Buffer.from('claude-token'))
    const codex = repo.save(
      { ...profile, name: 'Codex 代理', target: 'codex', wireApi: 'chat' },
      Buffer.from('codex-token')
    )
    repo.setActive('claude', claude.id)
    repo.setActive('codex', codex.id)

    expect(repo.activeSecret('claude')?.profile).toMatchObject({
      id: claude.id,
      target: 'claude'
    })
    expect(repo.activeSecret('codex')?.profile).toMatchObject({
      id: codex.id,
      target: 'codex',
      wireApi: 'chat'
    })
    repo.setActive('codex', null)
    expect(repo.activeSecret('claude')?.profile.id).toBe(claude.id)
    expect(repo.activeSecret('codex')).toBeUndefined()
    db.close()
  })

  it('更新时省略 token 保留旧值，传 null 则清除', () => {
    const { db, repo } = seedDb()
    const saved = repo.save(profile, Buffer.from('keep-me'))
    repo.save({ ...profile, name: '改名', id: saved.id })
    expect(repo.activeSecret('claude')).toBeUndefined()
    repo.setActive('claude', saved.id)
    expect(repo.activeSecret('claude')?.token).toEqual(Buffer.from('keep-me'))

    repo.save({ ...profile, name: '改名', id: saved.id }, null)
    expect(repo.activeSecret('claude')?.token).toBeUndefined()
    expect(repo.list()[0].hasToken).toBe(false)
    db.close()
  })
})
