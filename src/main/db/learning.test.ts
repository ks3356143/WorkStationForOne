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

  it('v15 只给已有学习数据的库补管综起步卡', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsfo-learning-'))
    dirs.push(dir)
    const db = openDatabase(join(dir, 'workstation.db'))
    migrate(
      db,
      MIGRATIONS.filter((migration) => migration.version <= 14)
    )
    db.prepare(
      `INSERT INTO learning_items
        (id, subject, title, next_review_on, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run('existing', '英语二', 'existing card', '2026-10-29', 1, 1)

    migrate(db)

    const cards = new LearningRepository(db).list()
    expect(cards).toHaveLength(9)
    expect(cards.filter((card) => card.subject.startsWith('管综'))).toHaveLength(8)
    expect(cards.filter((card) => card.subject === '互联网')).toHaveLength(0)
    db.close()
  })

  it('空库迁移不写管综起步卡，交给首次种子', () => {
    const { db, repo } = seedDb()
    expect(repo.list()).toEqual([])
    db.close()
  })

  it('从 v13 升级时保留学习进度，FSRS 字段保持为空', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsfo-learning-'))
    dirs.push(dir)
    const db = openDatabase(join(dir, 'workstation.db'))
    migrate(
      db,
      MIGRATIONS.filter((migration) => migration.version <= 13)
    )
    db.prepare(
      `INSERT INTO learning_items
        (id, subject, title, next_review_on, repetitions, interval_days, ease, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run('old', '英语二', 'legacy', '2026-10-30', 3, 12, 2.2, 1, 1)

    migrate(db)

    const card = new LearningRepository(db).find('old')
    expect(card).toMatchObject({
      repetitions: 3,
      intervalDays: 12,
      ease: 2.2,
      lapses: 0
    })
    expect(card?.stability).toBeUndefined()
    expect(card?.difficulty).toBeUndefined()
    expect(card?.lastReviewOn).toBeUndefined()
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

    // 不写死版本号：后续迁移不该让这条断言失效，只验证「升到了最新」
    expect(userVersion(db)).toBe(Math.max(...MIGRATIONS.map((item) => item.version)))
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

describe('LearningRepository · 批量导入', () => {
  it('一次事务写入多张卡', () => {
    const { db, repo } = seedDb()
    const created = repo.createMany([
      { subject: '管综数学', title: '比例问题', notes: '详解' },
      { subject: '管综逻辑', title: '三段论' }
    ])

    expect(created).toHaveLength(2)
    expect(repo.list()).toHaveLength(2)
    db.close()
  })

  it('任一写入失败时整批回滚', () => {
    const { db, repo } = seedDb()
    repo.createMany([{ subject: '英语二', title: '已有' }])
    db.exec(
      "CREATE TRIGGER deny_import BEFORE INSERT ON learning_items WHEN NEW.title = 'boom' BEGIN SELECT RAISE(ABORT, 'denied'); END"
    )

    expect(() =>
      repo.createMany([
        { subject: '管综数学', title: '合法' },
        { subject: '管综数学', title: 'boom' }
      ])
    ).toThrow()
    expect(repo.list().map((card) => card.title)).toEqual(['已有'])
    db.close()
  })
})

describe('LearningRepository · 复习历史', () => {
  it('只返回时间窗内的评分并按时间升序', () => {
    const { db, repo } = seedDb()
    const card = repo.create({ subject: '管综逻辑', title: '三段论' })
    const at = (daysAgo: number) => Date.now() - daysAgo * 86_400_000
    const insert = db.prepare(
      'INSERT INTO learning_reviews (id, item_id, rating, reviewed_at) VALUES (?, ?, ?, ?)'
    )
    insert.run('r1', card.id, 3, at(20))
    insert.run('r2', card.id, 1, at(2))
    insert.run('r3', card.id, 4, at(1))

    const history = repo.reviewHistory(7)
    expect(history.map((entry) => entry.rating)).toEqual([1, 4])
    expect(history[0].reviewedAt).toBeLessThan(history[1].reviewedAt)
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
      intervalDays: 2,
      ease: 2.5,
      nextReviewOn: '2026-10-29',
      lastReviewOn: '2026-10-27'
    })
    expect(updated.stability).toBeCloseTo(2.3065, 3)
    expect(updated.difficulty).toBeCloseTo(2.117, 2)
    expect(updated.lapses).toBe(0)
    expect(updated.lastReviewedAt).toBeTypeOf('number')
    expect(repo.reviewCount('l1')).toBe(1)
    db.close()
  })

  it('重来不改动复习日并累计失误', () => {
    const { db, repo } = seedDb()
    repo.bootstrap([item({ repetitions: 3, intervalDays: 20, nextReviewOn: '2026-10-20' })])

    const updated = repo.review('l1', 1, '2026-10-27')

    expect(updated).toMatchObject({
      repetitions: 0,
      intervalDays: 0,
      nextReviewOn: '2026-10-27',
      lapses: 1,
      lastReviewOn: '2026-10-27'
    })
    expect(updated.stability).toBeGreaterThan(0)
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
    expect(repo.find('l1')?.stability).toBeUndefined()
    expect(repo.find('l1')?.lastReviewOn).toBeUndefined()
    db.close()
  })

  it('旧卡第一次走 FSRS 时沿用原间隔', () => {
    const { db, repo } = seedDb()
    repo.bootstrap([
      item({ repetitions: 3, intervalDays: 20, nextReviewOn: '2026-10-20', ease: 2.2 })
    ])

    const updated = repo.review('l1', 3, '2026-10-27')

    expect(updated).toMatchObject({ repetitions: 4, intervalDays: 20, stability: 20 })
    expect(updated.nextReviewOn).toBe('2026-11-16')
    db.close()
  })

  it('FSRS 状态随卡片持久化，重开后仍在', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsfo-learning-'))
    dirs.push(dir)
    const file = join(dir, 'workstation.db')

    const first = openDatabase(file)
    migrate(first)
    const repo = new LearningRepository(first)
    repo.bootstrap([item()])
    repo.review('l1', 4, '2026-10-27')
    first.close()

    const second = openDatabase(file)
    migrate(second)
    const reopened = new LearningRepository(second).find('l1')
    expect(reopened).toMatchObject({
      repetitions: 1,
      intervalDays: 8,
      nextReviewOn: '2026-11-04',
      lastReviewOn: '2026-10-27',
      lapses: 0
    })
    expect(reopened?.stability).toBeCloseTo(8.2956, 3)
    expect(reopened?.difficulty).toBe(1)
    second.close()
  })
})

describe('挖空卡与来源笔记', () => {
  it('挖空卡保留 kind、原文与来源笔记', () => {
    const { db, repo } = seedDb()
    const created = repo.create({
      subject: '互联网',
      title: '[1] 是面向连接的',
      kind: 'cloze',
      clozeSource: '{{c1::TCP}} 是面向连接的',
      noteId: 'n2'
    })
    expect(created).toMatchObject({
      kind: 'cloze',
      clozeSource: '{{c1::TCP}} 是面向连接的',
      noteId: 'n2'
    })
    db.close()
  })

  it('普通卡不带挖空字段', () => {
    const { db, repo } = seedDb()
    const created = repo.create({ subject: '英语二', title: 'analyze', notes: '分析' })
    expect(created.kind).toBeUndefined()
    expect(created.clozeSource).toBeUndefined()
    expect(created.noteId).toBeUndefined()
    db.close()
  })

  it('改挖空原文不会破坏复习进度', () => {
    const { db, repo } = seedDb()
    const created = repo.create({
      subject: '互联网',
      title: '[1] 是面向连接的',
      kind: 'cloze',
      clozeSource: '{{c1::TCP}} 是面向连接的'
    })
    repo.review(created.id, 3, '2026-10-28')
    repo.update(created.id, {
      clozeSource: '{{c1::TCP}} 是可靠的、面向连接的',
      title: '[1] 是可靠的、面向连接的'
    })
    const after = repo.find(created.id)
    expect(after?.clozeSource).toBe('{{c1::TCP}} 是可靠的、面向连接的')
    expect(after?.repetitions).toBe(1)
    expect(before(after?.intervalDays)).toBeGreaterThan(0)
    db.close()
  })

  it('重启后挖空字段仍然存在', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsfo-learning-'))
    dirs.push(dir)
    const file = join(dir, 'workstation.db')

    const first = openDatabase(file)
    migrate(first)
    new LearningRepository(first).create({
      subject: '互联网',
      title: '[1] 是面向连接的',
      kind: 'cloze',
      clozeSource: '{{c1::TCP}} 是面向连接的',
      noteId: 'n7'
    })
    first.close()

    const second = openDatabase(file)
    migrate(second)
    const [stored] = new LearningRepository(second).list()
    expect(stored).toMatchObject({ kind: 'cloze', noteId: 'n7' })
    second.close()
  })
})

function before(value: number | undefined): number {
  return value ?? 0
}
