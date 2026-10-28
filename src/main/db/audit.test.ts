import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AuditLog } from './audit'
import { migrate, openDatabase } from './database'

const dirs: string[] = []
function fresh() {
  const dir = mkdtempSync(join(tmpdir(), 'wsfo-audit-'))
  dirs.push(dir)
  const db = openDatabase(join(dir, 'workstation.db'))
  migrate(db)
  return { db, audit: new AuditLog(db) }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('AuditLog', () => {
  it('按时间倒序读回记录，字段完整', () => {
    const { db, audit } = fresh()
    audit.record({
      at: 1000,
      domain: 'task',
      action: 'create',
      targetId: 't1',
      title: '写周报'
    })
    audit.record({
      at: 2000,
      domain: 'note',
      action: 'create',
      targetId: 'n1',
      title: '一条笔记',
      source: 'capture'
    })

    const rows = audit.recent()
    expect(rows.map((row) => row.action)).toEqual(['create', 'create'])
    expect(rows[0]).toMatchObject({ domain: 'note', targetId: 'n1', source: 'capture' })
    expect(rows[1]).toMatchObject({ domain: 'task', title: '写周报', source: 'ui' })
    db.close()
  })

  it('limit 生效，count 统计全部', () => {
    const { db, audit } = fresh()
    for (let index = 0; index < 5; index += 1) {
      audit.record({ at: index, domain: 'task', action: 'update', targetId: `t${index}` })
    }
    expect(audit.recent(2)).toHaveLength(2)
    expect(audit.count()).toBe(5)
    db.close()
  })

  it('写入失败不抛错：审计不能拖垮业务写入', () => {
    const { db, audit } = fresh()
    db.close()
    expect(() => audit.record({ at: 1, domain: 'task', action: 'create' })).not.toThrow()
  })
})
