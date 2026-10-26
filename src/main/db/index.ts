import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { migrate, openDatabase } from './database'
import { NoteRepository } from './notes'
import { TaskRepository } from './tasks'

export interface DatabaseContext {
  tasks: TaskRepository
  notes: NoteRepository
  close: () => void
}

export function initDatabase(): DatabaseContext {
  // 自动化测试通过 WS_DATA_DIR 指向临时目录，避免改写用户的真实数据。
  const dir = process.env.WS_DATA_DIR || join(app.getPath('appData'), 'WorkStationForOne', 'data')
  mkdirSync(dir, { recursive: true })
  const db = openDatabase(join(dir, 'workstation.db'))
  migrate(db)
  return {
    tasks: new TaskRepository(db),
    notes: new NoteRepository(db),
    close: () => db.close()
  }
}
