import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CapabilityRepository } from '../../db/capabilities'
import { migrate, openDatabase } from '../../db/database'
import { githubSlug, PluginSourceService } from './sources-service'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

/** 造一个符合两种 Agent 的市场仓库。 */
function makeMarketplace(root: string, name = 'community'): string {
  mkdirSync(join(root, '.claude-plugin'), { recursive: true })
  mkdirSync(join(root, 'plugins', 'demo'), { recursive: true })
  writeFileSync(
    join(root, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({
      name,
      owner: { name: 'me' },
      plugins: [{ name: 'demo', source: './plugins/demo', description: 'Demo' }]
    })
  )
  return root
}

function setup() {
  const base = tempDir('wsfo-srcsvc-')
  const db = openDatabase(join(base, 'workstation.db'))
  migrate(db)
  const repository = new CapabilityRepository(db)
  const service = new PluginSourceService({
    repository,
    appDataDir: base,
    claudeConfigDir: join(base, 'claude-config'),
    codexHome: join(base, 'codex-home'),
    claudeCli: null,
    codexCli: null
  })
  return { base, db, repository, service }
}

describe('githubSlug', () => {
  it('把 GitHub 地址转成 owner/repo', () => {
    expect(githubSlug('https://github.com/anthropics/claude-plugins-official')).toBe(
      'anthropics/claude-plugins-official'
    )
    expect(githubSlug('https://github.com/a/b.git')).toBe('a/b')
    expect(githubSlug('git@github.com:a/b.git')).toBe('a/b')
  })

  it('非 GitHub 地址返回 null', () => {
    expect(githubSlug('https://gitlab.com/a/b')).toBeNull()
    expect(githubSlug('D:plugins')).toBeNull()
    expect(githubSlug(undefined)).toBeNull()
  })
})

describe('PluginSourceService', () => {
  it('添加本地目录源后入库并读到插件清单', async () => {
    const { base, db, repository, service } = setup()
    const market = makeMarketplace(tempDir('wsfo-market-'))

    const saved = await service.add({ name: 'community', url: market })
    expect(saved).toMatchObject({ name: 'community', kind: 'git', pluginCount: 1 })
    expect(repository.listSources()).toHaveLength(1)

    const { plugins, error } = service.pluginsOf(saved)
    expect(error).toBe('')
    expect(plugins.map((plugin) => plugin.name)).toEqual(['demo'])
    expect(service.resolvePluginRoot(saved, plugins[0])).toContain('plugins')
    expect(base).toBeTruthy()
    db.close()
  })

  it('重复名称拒绝添加，失败时不留下半成品记录', async () => {
    const { db, repository, service } = setup()
    const market = makeMarketplace(tempDir('wsfo-market-'))
    await service.add({ name: 'community', url: market })

    await expect(service.add({ name: 'community', url: market })).rejects.toThrow()
    expect(repository.listSources()).toHaveLength(1)
    db.close()
  })

  it('缺少清单的目录添加失败且不留记录', async () => {
    const { db, repository, service } = setup()
    const empty = tempDir('wsfo-empty-')
    await expect(service.add({ name: 'broken', url: empty })).rejects.toThrow(/marketplace/)
    expect(repository.listSources()).toEqual([])
    db.close()
  })

  it('刷新记录插件数与时间，失败写可读错误', async () => {
    const { db, repository, service } = setup()
    const market = makeMarketplace(tempDir('wsfo-market-'))
    const saved = await service.add({ name: 'community', url: market })

    const refreshed = await service.refresh(saved.id)
    expect(refreshed.plugins).toHaveLength(1)
    expect(repository.findSource(saved.id)?.pluginCount).toBe(1)
    expect(repository.findSource(saved.id)?.lastSyncedAt).toBeTypeOf('number')

    rmSync(join(market, '.claude-plugin', 'marketplace.json'))
    await expect(service.refresh(saved.id)).rejects.toThrow(/marketplace/)
    expect(repository.findSource(saved.id)?.lastError).toContain('marketplace')
    expect(repository.findSource(saved.id)?.pluginCount).toBe(1)
    db.close()
  })

  it('移除源时删除记录，本地目录源保留用户目录', async () => {
    const { db, repository, service } = setup()
    const market = makeMarketplace(tempDir('wsfo-market-'))
    const saved = await service.add({ name: 'community', url: market })

    await service.remove(saved.id)
    expect(repository.listSources()).toEqual([])
    expect(market).toBeTruthy()
    db.close()
  })

  it('官方源不允许移除', async () => {
    const { db, repository, service } = setup()
    const market = makeMarketplace(tempDir('wsfo-market-'), 'wsfo-official')
    const saved = await service.add({ name: 'official', url: market, kind: 'official' })
    await expect(service.remove(saved.id)).rejects.toThrow(/官方源/)
    expect(repository.listSources()).toHaveLength(1)
    db.close()
  })
})
