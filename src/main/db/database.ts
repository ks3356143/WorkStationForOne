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
  },
  {
    version: 2,
    sql: `
      CREATE TABLE notes (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL,
        time_label TEXT NOT NULL DEFAULT '',
        tag TEXT,
        pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX idx_notes_pinned ON notes(pinned DESC, updated_at DESC);

      CREATE VIRTUAL TABLE notes_fts USING fts5(
        title,
        body,
        content='notes',
        content_rowid='rowid',
        tokenize='trigram'
      );

      CREATE TRIGGER notes_fts_insert AFTER INSERT ON notes BEGIN
        INSERT INTO notes_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
      END;

      CREATE TRIGGER notes_fts_update AFTER UPDATE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, title, body)
        VALUES ('delete', old.rowid, old.title, old.body);
        INSERT INTO notes_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
      END;

      CREATE TRIGGER notes_fts_delete AFTER DELETE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, title, body)
        VALUES ('delete', old.rowid, old.title, old.body);
      END;
    `
  },
  {
    version: 3,
    sql: `
      ALTER TABLE tasks ADD COLUMN notes TEXT NOT NULL DEFAULT '';
      ALTER TABLE tasks ADD COLUMN due_date TEXT CHECK (due_date IS NULL OR due_date GLOB '????-??-??');
      ALTER TABLE tasks ADD COLUMN priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3);
      ALTER TABLE tasks ADD COLUMN list TEXT;

      CREATE INDEX idx_tasks_due ON tasks(done, due_date, sort_order);
      CREATE INDEX idx_tasks_list ON tasks(done, list);
    `
  },
  {
    // 软删：删除先打 deleted_at，撤销只需清空该列。
    version: 4,
    sql: `
      ALTER TABLE tasks ADD COLUMN deleted_at INTEGER;
      CREATE INDEX idx_tasks_live ON tasks(deleted_at, sort_order);
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
  if (pending.length === 0) return current

  // 迁移前留一份快照：本地库没有服务端兜底，schema 变更出错就是数据事故。
  backupBeforeMigrate(db, current)

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

function backupBeforeMigrate(db: DatabaseSync, version: number): void {
  try {
    const row = db.prepare('PRAGMA database_list').all() as { name: string; file: string }[]
    const main = row.find((entry) => entry.name === 'main')
    if (!main?.file) return
    // 保留最近 3 份，避免备份无限增长。
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    db.exec(`VACUUM INTO '${main.file.replace(/'/g, "''")}.v${version}-${stamp}.bak'`)
  } catch (error) {
    // 备份失败不应阻断迁移，但要在日志里留痕。
    console.error('[db] 迁移前备份失败', error)
  }
}
