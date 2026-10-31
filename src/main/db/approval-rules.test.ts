import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { workspaceKey } from '../../shared/approval-rules'
import { ApprovalRuleRepository } from './approval-rules'
import { MIGRATIONS, migrate, openDatabase, userVersion } from './database'

const dirs: string[] = []

function seedDb() {
  const dir = mkdtempSync(join(tmpdir(), 'wsfo-approval-rule-'))
  dirs.push(dir)
  const db = openDatabase(join(dir, 'workstation.db'))
  migrate(db)
  return { db, repo: new ApprovalRuleRepository(db) }
}

afterEach(() => {
  while (dirs.length) {
    rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

describe('迁移 v27', () => {
  it('建立 approval_rules 并推进到最新版本', () => {
    const { db } = seedDb()
    expect(userVersion(db)).toBe(MIGRATIONS.at(-1)!.version)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'approval_rules'")
      .all()
    expect(tables).toHaveLength(1)
    db.close()
  })

  it('从 v26 升级保留已有数据', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsfo-approval-upgrade-'))
    dirs.push(dir)
    const db = openDatabase(join(dir, 'workstation.db'))
    migrate(
      db,
      MIGRATIONS.filter((migration) => migration.version <= 26)
    )
    db.prepare(
      `INSERT INTO agent_sessions (id, agent, title, status, created_at, updated_at)
       VALUES ('s1', 'claude', '旧会话', 'idle', 1, 1)`
    ).run()

    migrate(db)

    expect(userVersion(db)).toBe(27)
    expect(db.prepare('SELECT title FROM agent_sessions WHERE id = ?').get('s1')).toEqual({
      title: '旧会话'
    })
    db.close()
  })
})

describe('ApprovalRuleRepository', () => {
  const input = {
    id: 'rule-1',
    agent: 'claude' as const,
    workspace: 'C:\\Work\\Demo',
    workspaceKey: workspaceKey('C:\\Work\\Demo'),
    toolName: 'mcp__memory__read',
    now: 100
  }

  it('插入时 last_used_at 为空，重复授予复用同一行', () => {
    const { db, repo } = seedDb()
    const first = repo.upsert(input)
    expect(first).toMatchObject({ id: 'rule-1', lastUsedAt: null })

    const second = repo.upsert({
      ...input,
      id: 'rule-2',
      workspace: 'c:/work/demo',
      workspaceKey: workspaceKey('c:/work/demo'),
      now: 200
    })
    expect(second).toMatchObject({ id: 'rule-1', lastUsedAt: 200 })
    expect(repo.list()).toHaveLength(1)
    db.close()
  })

  it('touch 只更新最近使用时间，remove 删行', () => {
    const { db, repo } = seedDb()
    repo.upsert(input)
    repo.touch('rule-1', 300)
    expect(repo.find('claude', input.workspaceKey, input.toolName)?.lastUsedAt).toBe(300)
    expect(repo.remove('rule-1')).toBe(true)
    expect(repo.remove('rule-1')).toBe(false)
    expect(repo.list()).toHaveLength(0)
    db.close()
  })

  it('按最近使用与创建时间倒序排列', () => {
    const { db, repo } = seedDb()
    repo.upsert({ ...input, id: 'a', toolName: 'Read', now: 100 })
    repo.upsert({ ...input, id: 'b', toolName: 'Grep', now: 200 })
    repo.upsert({ ...input, id: 'c', toolName: 'Glob', now: 150 })
    repo.touch('a', 400)
    expect(repo.list().map((rule) => rule.id)).toEqual(['a', 'b', 'c'])
    db.close()
  })
})
