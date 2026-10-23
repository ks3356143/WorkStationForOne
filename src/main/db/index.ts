import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { migrate, openDatabase } from './database'
import { TaskRepository } from './tasks'

export interface DatabaseContext {
  tasks: TaskRepository
  close: () => void
}

export function initDatabase(): DatabaseContext {
  const dir = join(app.getPath('appData'), 'WorkStationForOne', 'data')
  mkdirSync(dir, { recursive: true })
  const db = openDatabase(join(dir, 'workstation.db'))
  migrate(db)
  return {
    tasks: new TaskRepository(db),
    close: () => db.close()
  }
}
