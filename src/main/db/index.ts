import { app } from 'electron'
import type { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { AuditLog } from './audit'
import { migrate, openDatabase } from './database'
import { HabitRepository } from './habits'
import { LearningRepository } from './learning'
import { NoteRepository } from './notes'
import { TaskRepository } from './tasks'

export interface DatabaseContext {
  /** 库文件路径与原始连接：备份模块要直接对连接做 VACUUM INTO */
  file: string
  db: DatabaseSync
  tasks: TaskRepository
  notes: NoteRepository
  learning: LearningRepository
  habits: HabitRepository
  audit: AuditLog
  close: () => void
}

export function initDatabase(): DatabaseContext {
  // 自动化测试通过 WS_DATA_DIR 指向临时目录，避免改写用户的真实数据。
  const dir = process.env.WS_DATA_DIR || join(app.getPath('appData'), 'WorkStationForOne', 'data')
  mkdirSync(dir, { recursive: true })
  const db = openDatabase(join(dir, 'workstation.db'))
  migrate(db)
  const audit = new AuditLog(db)
  return {
    file: join(dir, 'workstation.db'),
    db,
    audit,
    tasks: new TaskRepository(db, audit),
    notes: new NoteRepository(db, audit),
    learning: new LearningRepository(db, audit),
    habits: new HabitRepository(db, audit),
    close: () => db.close()
  }
}
