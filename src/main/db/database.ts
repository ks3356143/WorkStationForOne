import { DatabaseSync } from 'node:sqlite'

export interface Migration {
  version: number
  sql: string
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        time_label TEXT NOT NULL DEFAULT '—',
        tag TEXT,
        tone TEXT CHECK (tone IS NULL OR tone IN ('agent', 'hot')),
        done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER
      );

      CREATE INDEX idx_tasks_done ON tasks(done, sort_order);
    `
  }
]

export function openDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec('PRAGMA busy_timeout = 5000;')
  return db
}

export function userVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version?: number } | undefined
  return Number(row?.user_version ?? 0)
}

export function migrate(db: DatabaseSync, migrations: Migration[] = MIGRATIONS): number {
  let current = userVersion(db)
  const pending = migrations.filter((migration) => migration.version > current).sort((a, b) => a.version - b.version)

  for (const migration of pending) {
    db.exec('BEGIN')
    try {
      db.exec(migration.sql)
      db.exec(`PRAGMA user_version = ${migration.version}`)
      db.exec('COMMIT')
      current = migration.version
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }

  return current
}
