import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AuditLog } from './audit'
import { MIGRATIONS, migrate, openDatabase, userVersion } from './database'
import { McpPolicyRepository } from './mcp'

const dirs: string[] = []

function seedDb() {
  const dir = mkdtempSync(join(tmpdir(), 'wsfo-mcp-'))
  dirs.push(dir)
  const db = openDatabase(join(dir, 'workstation.db'))
  migrate(db)
  const audit = new AuditLog(db)
  return { db, audit, repo: new McpPolicyRepository(db, audit) }
}

afterEach(() => {
  while (dirs.length) {
    rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

describe('迁移 v18', () => {
  it('建立 MCP 域权限表并写入默认值', () => {
    const { db, repo } = seedDb()
    expect(userVersion(db)).toBe(MIGRATIONS.at(-1)!.version)
    expect(repo.list()).toEqual([
      { domain: 'task', mode: 'write' },
      { domain: 'habit', mode: 'read' },
      { domain: 'learning', mode: 'read' },
      { domain: 'note', mode: 'read' }
    ])
    db.close()
  })
})

describe('McpPolicyRepository', () => {
  it('切换域权限并写 system/settings 审计', () => {
    const { db, audit, repo } = seedDb()
    expect(repo.set('note', 'ask')).toEqual({ domain: 'note', mode: 'ask' })
    expect(repo.mode('note')).toBe('ask')
    expect(repo.list().find((item) => item.domain === 'note')?.mode).toBe('ask')
    expect(audit.recent(5, 'system')).toContainEqual(
      expect.objectContaining({
        domain: 'system',
        action: 'settings',
        targetId: 'note',
        detail: 'note → ask'
      })
    )
    db.close()
  })

  it('重复设置只更新一行', () => {
    const { db, repo } = seedDb()
    repo.set('task', 'read')
    repo.set('task', 'write')
    expect(repo.list().filter((item) => item.domain === 'task')).toEqual([
      { domain: 'task', mode: 'write' }
    ])
    db.close()
  })
})

describe('内置工具开关（DB v29）', () => {
  const KNOWN = ['tasks_list', 'tasks_create', 'notes_search']

  it('没有记录时视为全部启用', () => {
    const { db, repo } = seedDb()
    expect(repo.disabledTools(KNOWN)).toEqual([])
    expect(repo.isToolEnabled('tasks_list')).toBe(true)
    db.close()
  })

  it('关闭后进入禁用集合，重新开启后移除', () => {
    const { db, repo } = seedDb()
    repo.setToolEnabled('tasks_create', false)
    expect(repo.isToolEnabled('tasks_create')).toBe(false)
    expect(repo.disabledTools(KNOWN)).toEqual(['tasks_create'])

    repo.setToolEnabled('tasks_create', true)
    expect(repo.isToolEnabled('tasks_create')).toBe(true)
    expect(repo.disabledTools(KNOWN)).toEqual([])
    db.close()
  })

  it('开关切换写审计，且不改动域权限', () => {
    const { db, audit, repo } = seedDb()
    repo.setToolEnabled('notes_search', false)
    expect(audit.recent(5, 'system')).toContainEqual(
      expect.objectContaining({
        domain: 'system',
        action: 'settings',
        targetId: 'notes_search',
        detail: 'builtin-tool → disabled'
      })
    )
    expect(repo.list()).toEqual([
      { domain: 'task', mode: 'write' },
      { domain: 'habit', mode: 'read' },
      { domain: 'learning', mode: 'read' },
      { domain: 'note', mode: 'read' }
    ])
    db.close()
  })

  it('未知工具名拒绝写入', () => {
    const { db, repo } = seedDb()
    expect(() => repo.setToolEnabled('not_a_tool', false)).toThrow(/未知的内置工具/)
    db.close()
  })
})
