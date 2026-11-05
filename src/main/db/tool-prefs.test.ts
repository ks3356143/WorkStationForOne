import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS, migrate, openDatabase, userVersion } from './database'
import { ToolPrefRepository } from './tool-prefs'

const dirs: string[] = []

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'wsfo-tool-prefs-'))
  dirs.push(dir)
  const db = openDatabase(join(dir, 'workstation.db'))
  migrate(db)
  return { db, repo: new ToolPrefRepository(db) }
}

afterEach(() => {
  while (dirs.length) {
    rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

describe('工具面偏好', () => {
  it('迁移到最新版本并默认启用原生工具', () => {
    const { db, repo } = setup()
    expect(userVersion(db)).toBe(MIGRATIONS.at(-1)!.version)
    expect(MIGRATIONS.at(-1)!.version).toBe(45)
    expect(repo.disabledNative('claude')).toEqual([])
    repo.setNative('claude', 'web', false)
    expect(repo.disabledNative('claude')).toEqual(['web'])
    repo.setNative('claude', 'web', true)
    expect(repo.disabledNative('claude')).toEqual([])
    db.close()
  })

  it('首选默认关闭，可切换且排序不会清掉首选', () => {
    const { db, repo } = setup()
    expect(repo.preferred('claude').size).toBe(0)
    repo.setPreferred('claude', 'mcp:desktop', true)
    repo.setPreferred('claude', 'skill:pdf', true)
    expect([...repo.preferred('claude')].sort()).toEqual(['mcp:desktop', 'skill:pdf'])
    repo.setOrder('claude', ['skill:pdf', 'mcp:desktop'])
    expect([...repo.preferred('claude')].sort()).toEqual(['mcp:desktop', 'skill:pdf'])
    repo.setPreferred('claude', 'mcp:desktop', false)
    expect([...repo.preferred('claude')]).toEqual(['skill:pdf'])
    db.close()
  })

  it('原生工具不能标成首选；关掉首选也不影响原生开关', () => {
    const { db, repo } = setup()
    repo.setNative('claude', 'web', false)
    repo.setPreferred('claude', 'mcp:desktop', true)
    expect(repo.disabledNative('claude')).toEqual(['web'])
    expect(repo.list('claude').find((row) => row.key === 'mcp:desktop')?.preferred).toBe(true)
    expect(repo.list('claude').find((row) => row.key === 'native:web')?.preferred).toBe(false)
    db.close()
  })

  it('保存并读回排序，未设置的项保持默认', () => {
    const { db, repo } = setup()
    repo.setOrder('codex', ['mcp:b', 'mcp:a'])
    expect(repo.order('codex').get('mcp:b')).toBe(0)
    expect(repo.order('codex').get('mcp:a')).toBe(1)
    expect(repo.order('codex').get('mcp:c')).toBeUndefined()
    db.close()
  })

  it('设置排序不会意外关闭原生工具', () => {
    const { db, repo } = setup()
    repo.setNative('claude', 'shell', false)
    repo.setOrder('claude', ['mcp:x'])
    expect(repo.disabledNative('claude')).toEqual(['shell'])
    db.close()
  })

  it('用途说明可保存与清空，不影响首选、排序与开关', () => {
    const { db, repo } = setup()
    repo.setPreferred('claude', 'mcp:s1', true)
    repo.setOrder('claude', ['mcp:s1'])
    repo.setNote('claude', 'mcp:s1', '窗口截图')
    expect(repo.notes('claude').get('mcp:s1')).toBe('窗口截图')
    expect(repo.preferred('claude').has('mcp:s1')).toBe(true)
    expect(repo.order('claude').get('mcp:s1')).toBe(0)
    repo.setNote('claude', 'mcp:s1', '')
    expect(repo.notes('claude').has('mcp:s1')).toBe(false)
    expect(repo.preferred('claude').has('mcp:s1')).toBe(true)
    db.close()
  })

  it('删除 MCP / 插件时清理对应偏好', () => {
    const { db, repo } = setup()
    repo.setOrder('claude', ['mcp:s1', 'skill:p1'])
    repo.setPreferred('claude', 'mcp:s1', true)
    repo.remove('claude', 'mcp:s1')
    expect(repo.order('claude').has('mcp:s1')).toBe(false)
    expect(repo.preferred('claude').has('mcp:s1')).toBe(false)
    repo.remove('claude', 'skill:p1')
    expect(repo.list('claude')).toEqual([])
    db.close()
  })
})

describe('v41 → 最新迁移', () => {
  it('保留旧开关与排序，首选默认 false、说明默认空', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsfo-tool-prefs-upgrade-'))
    dirs.push(dir)
    const db = openDatabase(join(dir, 'workstation.db'))
    migrate(
      db,
      MIGRATIONS.filter((migration) => migration.version <= 41)
    )
    expect(userVersion(db)).toBe(41)

    const insert = db.prepare(
      `INSERT INTO agent_tool_prefs (agent, tool_key, enabled, sort_order, updated_at)
       VALUES (?, ?, ?, ?, 1)`
    )
    insert.run('claude', 'native:web', 0, 0)
    insert.run('claude', 'mcp:desktop', 1, 0)
    insert.run('claude', 'skill:pdf', 1, 1)
    insert.run('codex', 'native:shell', 0, 0)

    migrate(db)
    const repo = new ToolPrefRepository(db)

    expect(userVersion(db)).toBe(MIGRATIONS.at(-1)!.version)
    expect(repo.disabledNative('claude')).toEqual(['web'])
    expect(repo.disabledNative('codex')).toEqual(['shell'])
    expect(repo.order('claude').get('mcp:desktop')).toBe(0)
    expect(repo.order('claude').get('skill:pdf')).toBe(1)
    // 旧库没有首选概念，升级后不能凭空标一个
    expect(repo.preferred('claude').size).toBe(0)
    expect(repo.list('claude').every((row) => row.preferred === false)).toBe(true)
    expect(repo.list('claude').every((row) => row.note === '')).toBe(true)

    // 升级后新写入的首选必须能落库
    repo.setPreferred('claude', 'mcp:desktop', true)
    expect([...repo.preferred('claude')]).toEqual(['mcp:desktop'])
    db.close()
  })
})
