import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { migrate, openDatabase } from './database'
import { FocusRepository } from './focus'

const dirs: string[] = []
const dbs: DatabaseSync[] = []
function seed(): FocusRepository {
  const dir = mkdtempSync(join(tmpdir(), 'wsfo-focus-'))
  dirs.push(dir)
  const db = openDatabase(join(dir, 'workstation.db'))
  dbs.push(db)
  migrate(db)
  return new FocusRepository(db)
}

afterEach(() => {
  while (dbs.length) dbs.pop()!.close()
  while (dirs.length)
    rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

describe('FocusRepository', () => {
  it('记录专注并可列出', () => {
    const repo = seed()
    const now = Date.now()
    const record = repo.log({
      label: '深度工作',
      kind: 'focus',
      minutes: 25,
      startedAt: now - 25 * 60000,
      completedAt: now
    })
    expect(record.id).toBeTruthy()
    expect(record.minutes).toBe(25)
    expect(repo.recent(7)).toHaveLength(1)
  })

  it('taskMinutes 只累计该任务的专注段', () => {
    const repo = seed()
    const now = Date.now()
    repo.log({
      taskId: 't1',
      label: 'a',
      kind: 'focus',
      minutes: 25,
      startedAt: now,
      completedAt: now
    })
    repo.log({
      taskId: 't1',
      label: 'b',
      kind: 'focus',
      minutes: 10,
      startedAt: now,
      completedAt: now
    })
    repo.log({
      taskId: 't1',
      label: '休息',
      kind: 'break',
      minutes: 5,
      startedAt: now,
      completedAt: now
    })
    repo.log({
      taskId: 't2',
      label: 'c',
      kind: 'focus',
      minutes: 50,
      startedAt: now,
      completedAt: now
    })
    expect(repo.taskMinutes('t1')).toBe(35)
    expect(repo.taskMinutes('t2')).toBe(50)
    expect(repo.taskMinutes('missing')).toBe(0)
  })

  it('recent 只返回窗口内记录', () => {
    const repo = seed()
    const now = Date.now()
    repo.log({
      label: '旧',
      kind: 'focus',
      minutes: 25,
      startedAt: now - 40 * 86400000,
      completedAt: now - 40 * 86400000
    })
    repo.log({ label: '新', kind: 'focus', minutes: 25, startedAt: now, completedAt: now })
    const recent = repo.recent(7)
    expect(recent).toHaveLength(1)
    expect(recent[0].label).toBe('新')
  })

  it('分钟数夹住上限', () => {
    const repo = seed()
    const record = repo.log({
      label: 'x',
      kind: 'focus',
      minutes: 99999,
      startedAt: Date.now(),
      completedAt: Date.now()
    })
    expect(record.minutes).toBe(1440)
  })

  it('非法 kind 拒绝', () => {
    const repo = seed()
    expect(() =>
      repo.log({ label: 'x', kind: 'nap' as never, minutes: 5, startedAt: Date.now() })
    ).toThrow()
  })
})
