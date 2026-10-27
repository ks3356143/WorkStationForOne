import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS, migrate, openDatabase, userVersion } from './database'
import { TaskRepository } from './tasks'
import type { TaskRecord } from '../../shared/ipc'

const dirs: string[] = []

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'wsfo-db-'))
  dirs.push(dir)
  return dir
}

function tempDb() {
  return openDatabase(join(tempDir(), 'workstation.db'))
}

const seed: TaskRecord[] = [
  { id: 't1', title: '站会', time: '09:00', done: true },
  { id: 't2', title: '重构 auth', time: '10:30', done: false, tag: 'Claude', tone: 'agent' },
  { id: 't3', title: '跑步', time: '19:00', done: false }
]

afterEach(() => {
  while (dirs.length) {
    rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

describe('migrate', () => {
  it('开启 WAL 并前向迁移到最新版本', () => {
    const db = tempDb()
    expect(userVersion(db)).toBe(0)

    migrate(db)

    expect(userVersion(db)).toBe(MIGRATIONS.at(-1)!.version)
    const journal = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string }
    expect(journal.journal_mode).toBe('wal')
    db.close()
  })

  it('重复迁移是幂等的', () => {
    const db = tempDb()
    migrate(db)
    migrate(db)
    expect(userVersion(db)).toBe(MIGRATIONS.at(-1)!.version)
    db.close()
  })

  it('迁移失败时回滚并保留原版本', () => {
    const db = tempDb()
    migrate(db, [{ version: 1, sql: 'CREATE TABLE a (id TEXT);' }])
    expect(userVersion(db)).toBe(1)

    expect(() =>
      migrate(db, [
        { version: 1, sql: 'CREATE TABLE a (id TEXT);' },
        { version: 2, sql: 'CREATE TABLE a (id TEXT);' }
      ])
    ).toThrow()

    expect(userVersion(db)).toBe(1)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='a'")
      .all()
    expect(tables).toHaveLength(1)
    db.close()
  })
})

describe('TaskRepository', () => {
  it('首次启动写入种子任务并保持顺序', () => {
    const db = tempDb()
    migrate(db)
    const repo = new TaskRepository(db)

    repo.bootstrap(seed)

    expect(repo.list()).toMatchObject(seed)
    db.close()
  })

  it('已有数据时不再写入种子', () => {
    const db = tempDb()
    migrate(db)
    const repo = new TaskRepository(db)
    repo.bootstrap(seed)
    repo.setDone('t2', true)
    repo.bootstrap([{ id: 'x', title: '不应写入', time: '—', done: false }])

    const tasks = repo.list()
    expect(tasks).toHaveLength(3)
    expect(tasks.find((task) => task.id === 't2')?.done).toBe(true)
    db.close()
  })

  it('勾选状态可持久化并在重开后读回', () => {
    const dir = tempDir()
    const first = openDatabase(join(dir, 'workstation.db'))
    migrate(first)
    new TaskRepository(first).bootstrap(seed)
    new TaskRepository(first).setDone('t2', true)
    first.close()

    const second = openDatabase(join(dir, 'workstation.db'))
    migrate(second)
    const tasks = new TaskRepository(second).list()
    expect(tasks.find((task) => task.id === 't2')?.done).toBe(true)
    second.close()
  })

  it('应用权限变更后写入新时间与标签', () => {
    const db = tempDb()
    migrate(db)
    const repo = new TaskRepository(db)
    repo.bootstrap(seed)

    repo.applySchedule([
      { taskId: 't3', toTime: '22:00', toTag: '已顺延' },
      { taskId: 't2', toTime: '09:00', toTag: '明天' }
    ])

    const tasks = repo.list()
    expect(tasks.find((task) => task.id === 't3')).toMatchObject({ time: '22:00', tag: '已顺延' })
    expect(tasks.find((task) => task.id === 't2')).toMatchObject({ time: '09:00', tag: '明天' })
    db.close()
  })
})

describe('TaskRepository · TODO 字段', () => {
  it('新增任务写全字段并排在最前', () => {
    const db = tempDb()
    migrate(db)
    const repo = new TaskRepository(db)
    repo.bootstrap(seed)

    const created = repo.create({
      title: '交报告',
      time: '15:00',
      dueDate: '2026-10-30',
      priority: 1,
      list: '工作',
      notes: '先写提纲'
    })

    expect(created).toMatchObject({
      title: '交报告',
      time: '15:00',
      dueDate: '2026-10-30',
      priority: 1,
      list: '工作',
      notes: '先写提纲',
      done: false
    })
    expect(repo.list()[0].id).toBe(created.id)
    db.close()
  })

  it('更新任务并支持清空可选字段', () => {
    const db = tempDb()
    migrate(db)
    const repo = new TaskRepository(db)
    repo.bootstrap(seed)

    repo.update('t2', {
      title: '重构 auth · 二期',
      dueDate: '2026-10-26',
      priority: 3,
      list: '工作',
      notes: '拆分 token 刷新'
    })
    expect(repo.list().find((task) => task.id === 't2')).toMatchObject({
      title: '重构 auth · 二期',
      dueDate: '2026-10-26',
      priority: 3,
      list: '工作',
      notes: '拆分 token 刷新'
    })

    repo.update('t2', { dueDate: null, list: null, tag: null, tone: null })
    expect(repo.list().find((task) => task.id === 't2')).toMatchObject({
      dueDate: undefined,
      list: undefined,
      tag: undefined,
      tone: undefined
    })
    db.close()
  })

  it('删除任务后不再返回', () => {
    const db = tempDb()
    migrate(db)
    const repo = new TaskRepository(db)
    repo.bootstrap(seed)

    repo.remove('t3')

    expect(repo.list().map((task) => task.id)).toEqual(['t1', 't2'])
    db.close()
  })

  it('完成任务写入完成时间', () => {
    const db = tempDb()
    migrate(db)
    const repo = new TaskRepository(db)
    repo.bootstrap(seed)

    repo.setDone('t2', true)

    expect(typeof repo.list().find((task) => task.id === 't2')?.completedAt).toBe('number')
    db.close()
  })

  it('权限顺延写入新日期，也可清空日期', () => {
    const db = tempDb()
    migrate(db)
    const repo = new TaskRepository(db)
    repo.bootstrap(seed)
    const created = repo.create({ title: '顺延任务', dueDate: '2026-10-24' })

    repo.applySchedule([
      { taskId: created.id, toTime: '09:00', toTag: '明天', toDueDate: '2026-10-25' }
    ])
    expect(repo.list().find((task) => task.id === created.id)).toMatchObject({
      dueDate: '2026-10-25',
      time: '09:00',
      tag: '明天'
    })

    repo.applySchedule([{ taskId: created.id, toTime: '09:00', toTag: '', toDueDate: null }])
    expect(repo.list().find((task) => task.id === created.id)?.dueDate).toBeUndefined()
    db.close()
  })
})

describe('migrate v3', () => {
  it('旧任务不伪造截止日期，只带默认字段', () => {
    const db = tempDb()
    migrate(db, MIGRATIONS.slice(0, 2))
    db.prepare('INSERT INTO tasks (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      'legacy',
      '旧任务',
      1,
      1
    )

    migrate(db)

    const row = db
      .prepare('SELECT due_date, priority, notes, list FROM tasks WHERE id = ?')
      .get('legacy') as {
      due_date: string | null
      priority: number
      notes: string
      list: string | null
    }
    // 旧任务从未设定截止日期；迁移不能替用户编造一个「今天」。
    expect(row).toEqual({ due_date: null, priority: 0, notes: '', list: null })
    db.close()
  })
})

describe('软删除', () => {
  it('删除后不再出现在 list 与 find 中，但数据仍在表里', () => {
    const db = tempDb()
    migrate(db)
    const repo = new TaskRepository(db)
    repo.bootstrap(seed)

    repo.remove('t2')

    expect(repo.list().map((task) => task.id)).toEqual(['t1', 't3'])
    expect(repo.find('t2')).toBeUndefined()
    const row = db.prepare('SELECT deleted_at FROM tasks WHERE id = ?').get('t2') as {
      deleted_at: number | null
    }
    expect(row.deleted_at).toBeTypeOf('number')
    db.close()
  })

  it('撤销后任务回到列表并保留原字段', () => {
    const db = tempDb()
    migrate(db)
    const repo = new TaskRepository(db)
    repo.bootstrap(seed)

    repo.remove('t2')
    repo.restore('t2')

    const restored = repo.find('t2')
    expect(restored).toMatchObject({ id: 't2', title: '重构 auth', tag: 'Claude', tone: 'agent' })
    expect(repo.list().map((task) => task.id)).toEqual(['t1', 't2', 't3'])
    db.close()
  })

  it('软删后的任务不会被勾选或改写', () => {
    const db = tempDb()
    migrate(db)
    const repo = new TaskRepository(db)
    repo.bootstrap(seed)

    repo.remove('t2')
    repo.setDone('t2', true)
    repo.update('t2', { title: '被改掉' })
    repo.restore('t2')

    expect(repo.find('t2')).toMatchObject({ title: '重构 auth', done: false })
    db.close()
  })

  it('重复删除是幂等的，不会覆盖首次删除时间', () => {
    const db = tempDb()
    migrate(db)
    const repo = new TaskRepository(db)
    repo.bootstrap(seed)

    repo.remove('t1')
    const first = (
      db.prepare('SELECT deleted_at FROM tasks WHERE id = ?').get('t1') as { deleted_at: number }
    ).deleted_at
    repo.remove('t1')
    const second = (
      db.prepare('SELECT deleted_at FROM tasks WHERE id = ?').get('t1') as { deleted_at: number }
    ).deleted_at
    expect(second).toBe(first)
    db.close()
  })

  it('只清掉超过保留期的已删任务，不碰存活任务', () => {
    const db = tempDb()
    migrate(db)
    const repo = new TaskRepository(db)
    repo.bootstrap(seed)

    repo.remove('t1')
    repo.remove('t2')

    const purged = repo.purgeDeleted(Date.now() + 1000)
    expect(purged).toBe(2)
    expect(repo.list().map((task) => task.id)).toEqual(['t3'])
    const alive = (db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }).n
    expect(alive).toBe(1)

    repo.restore('t1')
    expect(repo.find('t1')).toBeUndefined()
    db.close()
  })

  it('未到保留期的已删任务不会被清理', () => {
    const db = tempDb()
    migrate(db)
    const repo = new TaskRepository(db)
    repo.bootstrap(seed)

    repo.remove('t1')
    expect(repo.purgeDeleted(Date.now() - 30 * 24 * 60 * 60 * 1000)).toBe(0)
    repo.restore('t1')
    expect(repo.find('t1')).toBeTruthy()
    db.close()
  })
})

describe('migrate v4', () => {
  it('新增 deleted_at 列且默认不删除任何任务', () => {
    const db = tempDb()
    migrate(db, MIGRATIONS.slice(0, 3))
    db.prepare('INSERT INTO tasks (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      'legacy',
      '旧任务',
      1,
      1
    )

    migrate(db)

    expect(userVersion(db)).toBe(MIGRATIONS.at(-1)!.version)
    const row = db.prepare('SELECT deleted_at FROM tasks WHERE id = ?').get('legacy') as {
      deleted_at: number | null
    }
    expect(row.deleted_at).toBeNull()
    const repo = new TaskRepository(db)
    expect(repo.list().map((task) => task.id)).toEqual(['legacy'])
    db.close()
  })
})

describe('迁移前备份', () => {
  it('迁移前在库旁写出一份快照，且快照可独立打开', () => {
    const dir = tempDir()
    const file = join(dir, 'workstation.db')
    const db = openDatabase(file)
    migrate(db, MIGRATIONS.slice(0, 2))
    db.prepare('INSERT INTO tasks (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)').run(
      'legacy',
      '旧任务',
      1,
      1
    )

    migrate(db)

    const backups = readdirSync(dir).filter(
      (name) => name.includes('.v2-') && name.endsWith('.bak')
    )
    expect(backups.length).toBe(1)
    const snapshot = openDatabase(join(dir, backups[0]))
    expect(userVersion(snapshot)).toBe(2)
    const rows = snapshot.prepare('SELECT id FROM tasks').all() as { id: string }[]
    expect(rows.map((row) => row.id)).toEqual(['legacy'])
    snapshot.close()
    db.close()
  })

  it('没有待执行迁移时不产生备份', () => {
    const dir = tempDir()
    const db = openDatabase(join(dir, 'workstation.db'))
    migrate(db)
    const before = readdirSync(dir).filter((name) => name.endsWith('.bak')).length
    migrate(db)
    expect(readdirSync(dir).filter((name) => name.endsWith('.bak')).length).toBe(before)
    db.close()
  })
})
