import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrate, openDatabase } from './database'
import { HabitRepository } from './habits'

const dirs: string[] = []

function seedDb() {
  const dir = mkdtempSync(join(tmpdir(), 'wsfo-habits-'))
  dirs.push(dir)
  const db = openDatabase(join(dir, 'workstation.db'))
  migrate(db)
  return { db, repo: new HabitRepository(db) }
}

afterEach(() => {
  while (dirs.length) {
    rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

describe('HabitRepository 管理', () => {
  it('创建、改名、删除并清掉打卡记录', () => {
    const { db, repo } = seedDb()
    const created = repo.create('喝水')

    expect(repo.list()).toEqual([{ id: created.id, name: '喝水', checkins: [] }])
    repo.setCheckin(created.id, '2026-11-04', true)
    expect(repo.list()[0].checkins).toEqual(['2026-11-04'])

    expect(repo.rename(created.id, '喝水 2L')).toBe(true)
    expect(repo.list()[0].name).toBe('喝水 2L')
    expect(repo.rename('missing', '不存在')).toBe(false)

    expect(repo.remove(created.id)).toBe(true)
    expect(repo.list()).toEqual([])
    const checkins = db
      .prepare('SELECT COUNT(*) AS n FROM habit_checkins WHERE habit_id = ?')
      .get(created.id) as { n: number }
    expect(checkins.n).toBe(0)
    expect(repo.remove(created.id)).toBe(false)
    db.close()
  })

  it('新习惯排在既有习惯之后', () => {
    const { db, repo } = seedDb()
    repo.bootstrap([
      { id: 'h1', name: '早起', checkins: [] },
      { id: 'h2', name: '喝水', checkins: [] }
    ])
    const created = repo.create('阅读')

    expect(repo.list().map((habit) => habit.name)).toEqual(['早起', '喝水', '阅读'])
    expect(created.checkins).toEqual([])
    db.close()
  })
})
