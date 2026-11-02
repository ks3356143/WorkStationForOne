import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CapabilityRepository } from './capabilities'
import { MIGRATIONS, migrate, openDatabase, userVersion } from './database'

const dirs: string[] = []

function seed(upTo?: number) {
  const dir = mkdtempSync(join(tmpdir(), 'wsfo-pluginsrc-'))
  dirs.push(dir)
  const db = openDatabase(join(dir, 'workstation.db'))
  migrate(db, upTo ? MIGRATIONS.filter((migration) => migration.version <= upTo) : undefined)
  return { db, repo: new CapabilityRepository(db) }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

const source = {
  id: 'src-1',
  name: 'community',
  kind: 'git' as const,
  url: 'https://github.com/example/plugins',
  ref: 'main',
  root: 'C:\\data\\agent\\plugin-sources\\community'
}

describe('插件源（DB v30）', () => {
  it('建立源表并推进到最新版本', () => {
    const { db } = seed()
    expect(userVersion(db)).toBe(MIGRATIONS.at(-1)!.version)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('plugin_sources')")
      .all() as { name: string }[]
    expect(tables.map((row) => row.name)).toEqual(['plugin_sources'])
    db.close()
  })

  it('源可增删改查，名称唯一', () => {
    const { db, repo } = seed()
    const saved = repo.createSource(source)
    expect(saved).toMatchObject({ name: 'community', kind: 'git', pluginCount: 0 })

    expect(() => repo.createSource({ ...source, id: 'src-2' })).toThrow(/已存在/)

    const listed = repo.listSources()
    expect(listed).toHaveLength(1)
    expect(repo.findSourceByName('community')?.id).toBe('src-1')
    expect(repo.findSource('src-1')?.url).toBe(source.url)

    repo.removeSource('src-1')
    expect(repo.listSources()).toEqual([])
    db.close()
  })

  it('同步结果记录刷新时间与错误', () => {
    const { db, repo } = seed()
    repo.createSource(source)
    repo.markSourceSynced('src-1', '', 4)
    expect(repo.findSource('src-1')).toMatchObject({
      pluginCount: 4,
      lastError: ''
    })
    expect(repo.findSource('src-1')?.lastSyncedAt).toBeTypeOf('number')

    repo.markSourceSynced('src-1', 'clone 失败', 0)
    expect(repo.findSource('src-1')).toMatchObject({ pluginCount: 0, lastError: 'clone 失败' })
    db.close()
  })

  it('插件按 Agent 与来源区分，同一插件可在两边各装一次', () => {
    const { db, repo } = seed()
    const base = {
      id: 'demo@community',
      name: 'demo',
      description: '',
      version: '1.0.0',
      marketplace: 'community',
      installPath: 'C:\\data\\claude\\demo',
      components: ['skills'],
      hasHooks: false,
      hasMcp: false,
      enabled: false,
      trusted: false,
      sourceId: 'src-1'
    }
    repo.upsertPlugin({ ...base, agent: 'claude' })
    repo.upsertPlugin({
      ...base,
      agent: 'codex',
      installPath: 'C:\\data\\codex\\demo'
    })

    const all = repo.listPlugins()
    expect(all).toHaveLength(2)
    expect(all.map((plugin) => plugin.agent).sort()).toEqual(['claude', 'codex'])
    expect(repo.listPlugins('codex')).toHaveLength(1)
    expect(repo.findPlugin('demo@community', 'codex')?.installPath).toContain('codex')
    db.close()
  })

  it('v29 旧库升级后既有插件归到 claude 且无来源', () => {
    const { db } = seed(29)
    db.prepare(
      `INSERT INTO agent_plugins
        (id, name, description, version, marketplace, install_path, components,
         has_hooks, has_mcp, enabled, trusted, installed_at, updated_at)
       VALUES ('old@market', 'old', '', '0.1.0', 'market', 'C:\\p', '[]', 0, 0, 1, 1, 1, 1)`
    ).run()
    migrate(db)
    const repo = new CapabilityRepository(db)
    expect(repo.findPlugin('old@market')?.agent).toBe('claude')
    expect(repo.findPlugin('old@market')?.sourceId).toBe('')
    expect(userVersion(db)).toBe(MIGRATIONS.at(-1)!.version)
    db.close()
  })
})
