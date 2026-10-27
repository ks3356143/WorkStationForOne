import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS, migrate, openDatabase, userVersion } from './database'
import { LearningRepository } from './learning'
import type { LearningItemRecord } from '../../shared/ipc'

const dirs: string[] = []

function seedDb() {
  const dir = mkdtempSync(join(tmpdir(), 'wsfo-learning-'))
  dirs.push(dir)
  const db = openDatabase(join(dir, 'workstation.db'))
  migrate(db)
  return { db, repo: new LearningRepository(db) }
}

afterEach(() => {
  while (dirs.length) {
    rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

function item(overrides: Partial<LearningItemRecord> = {}): LearningItemRecord {
  return {
    id: 'l1',
    subject: '英语二',
    title: 'analyze',
    source: '2021 阅读 Text 2',
    notes: 'v. 分析；解析',
    repetitions: 0,
    intervalDays: 0,
    ease: 2.5,
    nextReviewOn: '2026-10-27',
    active: true,
    ...overrides
  }
}

describe('迁移 v7', () => {
  it('建立学习卡片与复习记录表', () => {
    const { db } = seedDb()
    expect(userVersion(db)).toBe(MIGRATIONS.at(-1)!.version)
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'learning%' ORDER BY name"
      )
      .all()
      .map((row) => (row as { name: string }).name)
    expect(tables).toEqual(['learning_items', 'learning_reviews'])
    db.close()
  })

  it('从 v6 升级时保留原有任务数据', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsfo-learning-'))
    dirs.push(dir)
    const db = openDatabase(join(dir, 'workstation.db'))
    migrate(db, MIGRATIONS.slice(0, 6))
    db.prepare('INSERT INTO tasks (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      'legacy',
      '旧任务',
      1,
      1
    )

    migrate(db)

    expect(userVersion(db)).toBe(7)
    expect(new LearningRepository(db).list()).toEqual([])
    const row = db.prepare('SELECT title FROM tasks WHERE id = ?').get('legacy') as {
      title: string
    }
    expect(row.title).toBe('旧任务')
    db.close()
  })
})

describe('LearningRepository · 读取', () => {
  it('首次写入种子，已有数据则跳过', () => {
    const { db, repo } = seedDb()
    repo.bootstrap([item(), item({ id: 'l2', title: 'decline', nextReviewOn: '2026-10-25' })])
    repo.bootstrap([item({ id: 'x', title: '不应写入' })])

    expect(repo.list()).toHaveLength(2)
    // 停用排在启用之后，同组按复习日升序
    expect(repo.list().map((card) => card.id)).toEqual(['l2', 'l1'])
    db.close()
  })

  it('停用卡片排在最后且仍可读取', () => {
    const { db, repo } = seedDb()
    repo.bootstrap([item(), item({ id: 'l2', title: 'issue', active: false })])

    const list = repo.list()
    expect(list.map((card) => card.id)).toEqual(['l1', 'l2'])
    expect(list[1].active).toBe(false)
    db.close()
  })
})

describe('LearningRepository · 写入', () => {
  it('新建卡片默认今天到期、ease 2.5', () => {
    const { db, repo } = seedDb()
    const created = repo.create({ subject: '英语二', title: 'consume', notes: 'v. 消耗' })

    expect(created).toMatchObject({
      subject: '英语二',
      title: 'consume',
      notes: 'v. 消耗',
      repetitions: 0,
      intervalDays: 0,
      ease: 2.5,
      active: true
    })
    expect(created.nextReviewOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    db.close()
  })

  it('新建可指定复习日', () => {
    const { db, repo } = seedDb()
    const created = repo.create({
      subject: '互联网',
      title: 'CDN',
      nextReviewOn: '2026-11-02'
    })
    expect(created.nextReviewOn).toBe('2026-11-02')
    db.close()
  })

  it('更新字段与停用状态', () => {
    const { db, repo } = seedDb()
    repo.bootstrap([item()])

    repo.update('l1', { title: 'analyse', notes: '英式拼写', subject: '英语一' })
    expect(repo.find('l1')).toMatchObject({
      title: 'analyse',
      notes: '英式拼写',
      subject: '英语一'
    })

    repo.update('l1', { active: false })
    expect(repo.find('l1')?.active).toBe(false)
    db.close()
  })

  it('空补丁不产生写入', () => {
    const { db, repo } = seedDb()
    repo.bootstrap([item()])
    repo.update('l1', {})
    expect(repo.find('l1')?.title).toBe('analyze')
    db.close()
  })
})

describe('LearningRepository · 复习', () => {
  it('评分同时更新卡片并写入复习记录', () => {
    const { db, repo } = seedDb()
    repo.bootstrap([item()])

    const updated = repo.review('l1', 3, '2026-10-27')

    expect(updated).toMatchObject({
      repetitions: 1,
      intervalDays: 1,
      ease: 2.5,
      nextReviewOn: '2026-10-28'
    })
    expect(updated.lastReviewedAt).toBeTypeOf('number')
    expect(repo.reviewCount('l1')).toBe(1)
    db.close()
  })

  it('重来不改动复习日', () => {
    const { db, repo } = seedDb()
    repo.bootstrap([item({ repetitions: 3, intervalDays: 20, nextReviewOn: '2026-10-20' })])

    const updated = repo.review('l1', 1, '2026-10-27')

    expect(updated).toMatchObject({ repetitions: 0, intervalDays: 0, nextReviewOn: '2026-10-27' })
    expect(updated.ease).toBeCloseTo(2.3)
    db.close()
  })

  it('多次评分累积复习记录', () => {
    const { db, repo } = seedDb()
    repo.bootstrap([item()])
    repo.review('l1', 3, '2026-10-27')
    repo.review('l1', 4, '2026-10-28')

    expect(repo.reviewCount('l1')).toBe(2)
    expect(repo.find('l1')?.repetitions).toBe(2)
    db.close()
  })

  it('评分不存在的卡片会抛错且不写入记录', () => {
    const { db, repo } = seedDb()
    expect(() => repo.review('missing', 3)).toThrow()
    expect(repo.reviewCount('missing')).toBe(0)
    db.close()
  })

  it('评分事务失败时回滚卡片字段', () => {
    const { db, repo } = seedDb()
    repo.bootstrap([item()])
    // 让复习记录写入失败：提前占掉记录表，使 id 冲突不会发生但插入被约束挡住
    db.exec(
      "CREATE TRIGGER deny_review BEFORE INSERT ON learning_reviews BEGIN SELECT RAISE(ABORT, 'denied'); END"
    )

    expect(() => repo.review('l1', 3, '2026-10-27')).toThrow()
    expect(repo.find('l1')).toMatchObject({
      repetitions: 0,
      intervalDays: 0,
      nextReviewOn: '2026-10-27'
    })
    db.close()
  })
})
