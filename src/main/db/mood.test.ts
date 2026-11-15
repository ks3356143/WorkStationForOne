import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { migrate, openDatabase } from './database'
import { dateKey, addDaysKey } from '../../shared/date-key'
import { MoodRepository } from './mood'

const dirs: string[] = []
const dbs: DatabaseSync[] = []
function seed(): MoodRepository {
  const dir = mkdtempSync(join(tmpdir(), 'wsfo-mood-'))
  dirs.push(dir)
  const db = openDatabase(join(dir, 'workstation.db'))
  dbs.push(db)
  migrate(db)
  return new MoodRepository(db)
}

afterEach(() => {
  while (dbs.length) dbs.pop()!.close()
  while (dirs.length)
    rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

describe('MoodRepository', () => {
  it('保存并按日期读取', () => {
    const repo = seed()
    const today = dateKey()
    const saved = repo.save({ day: today, mood: 4, energy: 3, note: '还不错' })
    expect(saved.day).toBe(today)
    expect(saved.mood).toBe(4)
    expect(repo.get(today)?.note).toBe('还不错')
  })

  it('同一天重复保存是更新而非新增', () => {
    const repo = seed()
    const today = dateKey()
    repo.save({ day: today, mood: 2, energy: 2 })
    repo.save({ day: today, mood: 5, energy: 4, note: '好转' })
    expect(repo.get(today)?.mood).toBe(5)
    expect(repo.recent(30)).toHaveLength(1)
  })

  it('缺失日期返回 null', () => {
    const repo = seed()
    expect(repo.get('2000-01-01')).toBeNull()
  })

  it('心情与精力夹到 1–5', () => {
    const repo = seed()
    const today = dateKey()
    const saved = repo.save({ day: today, mood: 9, energy: 0 })
    expect(saved.mood).toBe(5)
    expect(saved.energy).toBe(1)
  })

  it('备注 trimming 并夹住上限', () => {
    const repo = seed()
    const saved = repo.save({ day: dateKey(), mood: 3, energy: 3, note: `  ${'x'.repeat(600)}  ` })
    expect(saved.note.length).toBe(500)
  })

  it('recent 只返回窗口内记录', () => {
    const repo = seed()
    const today = dateKey()
    repo.save({ day: addDaysKey(today, -40), mood: 1, energy: 1 })
    repo.save({ day: addDaysKey(today, -2), mood: 4, energy: 4 })
    repo.save({ day: today, mood: 5, energy: 5 })
    const recent = repo.recent(7)
    expect(recent).toHaveLength(2)
    expect(recent.map((item) => item.day)).toEqual([today, addDaysKey(today, -2)])
  })

  it('非法日期拒绝', () => {
    const repo = seed()
    expect(() => repo.save({ day: '2026-13-40', mood: 3, energy: 3 })).toThrow()
  })
})
