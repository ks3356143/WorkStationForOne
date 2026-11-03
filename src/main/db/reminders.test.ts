import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS, migrate, openDatabase, userVersion } from './database'
import { ReminderMuteRepository } from './reminders'
import { TaskRepository } from './tasks'

const dirs: string[] = []

function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'wsfo-reminder-mutes-'))
  dirs.push(dir)
  return dir
}

function setup() {
  const db = openDatabase(join(tempDir(), 'workstation.db'))
  migrate(db)
  const tasks = new TaskRepository(db)
  const task = tasks.create({ title: '提醒任务', time: '09:00', dueDate: '2026-11-03' })
  return { db, tasks, mutes: new ReminderMuteRepository(db), task }
}

afterEach(() => {
  while (dirs.length) {
    rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

describe('ReminderMuteRepository', () => {
  it('按任务与日期记录，重复静音不产生重复行', () => {
    const { db, mutes, task } = setup()

    mutes.mute(task.id, '2026-11-03', 1)
    mutes.mute(task.id, '2026-11-03', 2)

    expect(mutes.mutedIds('2026-11-03')).toEqual([task.id])
    expect(mutes.mutedIds('2026-11-04')).toEqual([])
    db.close()
  })

  it('可以按任务或整天恢复', () => {
    const { db, mutes, tasks, task } = setup()
    const second = tasks.create({ title: '第二条', time: '10:00', dueDate: '2026-11-03' })
    mutes.mute(task.id, '2026-11-03')
    mutes.mute(second.id, '2026-11-03')

    mutes.unmute(task.id, '2026-11-03')
    expect(mutes.mutedIds('2026-11-03')).toEqual([second.id])

    expect(mutes.unmuteDay('2026-11-03')).toBe(1)
    expect(mutes.mutedIds('2026-11-03')).toEqual([])
    db.close()
  })

  it('只清理今天之前的记录', () => {
    const { db, mutes, tasks, task } = setup()
    const second = tasks.create({ title: '明天', time: '09:00', dueDate: '2026-11-04' })
    mutes.mute(task.id, '2026-11-02')
    mutes.mute(second.id, '2026-11-04')

    expect(mutes.pruneBefore('2026-11-03')).toBe(1)
    expect(mutes.mutedIds('2026-11-02')).toEqual([])
    expect(mutes.mutedIds('2026-11-04')).toEqual([second.id])
    db.close()
  })

  it('硬删除任务时连带清理静音；软删除保留到恢复', () => {
    const { db, tasks, mutes, task } = setup()
    mutes.mute(task.id, '2026-11-03')

    tasks.remove(task.id)
    expect(mutes.mutedIds('2026-11-03')).toEqual([task.id])

    tasks.purgeDeleted(Date.now() + 1)
    expect(mutes.mutedIds('2026-11-03')).toEqual([])
    db.close()
  })

  it('v33 升级到 v34 后表可用', () => {
    const db = openDatabase(join(tempDir(), 'workstation.db'))
    migrate(
      db,
      MIGRATIONS.filter((migration) => migration.version <= 33)
    )
    expect(userVersion(db)).toBe(33)

    migrate(db)

    expect(userVersion(db)).toBe(MIGRATIONS.at(-1)!.version)
    const task = new TaskRepository(db).create({ title: '旧库任务', time: '09:00' })
    new ReminderMuteRepository(db).mute(task.id, '2026-11-03')
    expect(new ReminderMuteRepository(db).mutedIds('2026-11-03')).toEqual([task.id])
    db.close()
  })
})
