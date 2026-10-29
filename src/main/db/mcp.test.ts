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
