import { readdirSync, unlinkSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { MEM_STARTERS } from '../../shared/mem-starters'

export interface Migration {
  version: number
  sql: string
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/**
 * v15：只给已有学习数据的库补 8 张管综起步卡。
 * 空库必须留给渲染层首次种子（16 英语二 + 8 管综），否则只会写进 8 张。
 */
function memStarterSeedSql(): string {
  return MEM_STARTERS.map((card) => {
    const offset = Math.trunc(card.dayOffset)
    return `INSERT OR IGNORE INTO learning_items
      (id, subject, title, source, notes, repetitions, interval_days, ease,
       next_review_on, active, created_at, updated_at)
    SELECT ${sqlLiteral(card.id)}, ${sqlLiteral(card.subject)}, ${sqlLiteral(card.title)},
      ${sqlLiteral(card.source)}, ${sqlLiteral(card.notes)},
      0, 0, 2.5, date('now', 'localtime', '+${offset} day'), 1,
      CAST(strftime('%s', 'now') AS INTEGER) * 1000,
      CAST(strftime('%s', 'now') AS INTEGER) * 1000
    WHERE EXISTS (SELECT 1 FROM learning_items);`
  }).join('\n')
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
  },
  {
    // 标签也进全文索引：否则同一个词因字数不同走 FTS 或 LIKE，结果会不一致。
    version: 5,
    sql: `
      DROP TRIGGER notes_fts_insert;
      DROP TRIGGER notes_fts_update;
      DROP TRIGGER notes_fts_delete;
      DROP TABLE notes_fts;

      CREATE VIRTUAL TABLE notes_fts USING fts5(
        title,
        body,
        tag,
        content='notes',
        content_rowid='rowid',
        tokenize='trigram'
      );

      CREATE TRIGGER notes_fts_insert AFTER INSERT ON notes BEGIN
        INSERT INTO notes_fts(rowid, title, body, tag)
        VALUES (new.rowid, new.title, new.body, new.tag);
      END;

      CREATE TRIGGER notes_fts_update AFTER UPDATE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, title, body, tag)
        VALUES ('delete', old.rowid, old.title, old.body, old.tag);
        INSERT INTO notes_fts(rowid, title, body, tag)
        VALUES (new.rowid, new.title, new.body, new.tag);
      END;

      CREATE TRIGGER notes_fts_delete AFTER DELETE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, title, body, tag)
        VALUES ('delete', old.rowid, old.title, old.body, old.tag);
      END;

      INSERT INTO notes_fts(notes_fts) VALUES('rebuild');
    `
  },
  {
    // 计划做（planned_for）与截止（due_date）分开，容量视图只统计计划在今天的事项。
    version: 6,
    sql: `
      ALTER TABLE tasks ADD COLUMN planned_for TEXT
        CHECK (planned_for IS NULL OR planned_for GLOB '????-??-??');
      ALTER TABLE tasks ADD COLUMN estimate_minutes INTEGER NOT NULL DEFAULT 0
        CHECK (estimate_minutes BETWEEN 0 AND 480);
      CREATE INDEX idx_tasks_planned ON tasks(planned_for, deleted_at);
    `
  },
  {
    // 学习域：复习日按本地日期键存，与任务 due_date 同一套约定。
    version: 7,
    sql: `
      CREATE TABLE learning_items (
        id TEXT PRIMARY KEY,
        subject TEXT NOT NULL,
        title TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        repetitions INTEGER NOT NULL DEFAULT 0 CHECK (repetitions >= 0),
        interval_days INTEGER NOT NULL DEFAULT 0 CHECK (interval_days BETWEEN 0 AND 365),
        ease REAL NOT NULL DEFAULT 2.5 CHECK (ease BETWEEN 1.3 AND 3.0),
        next_review_on TEXT NOT NULL CHECK (next_review_on GLOB '????-??-??'),
        last_reviewed_at INTEGER,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX idx_learning_due ON learning_items(active, next_review_on);
      CREATE INDEX idx_learning_subject ON learning_items(subject, active);

      CREATE TABLE learning_reviews (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL REFERENCES learning_items(id) ON DELETE CASCADE,
        rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 4),
        reviewed_at INTEGER NOT NULL
      );

      CREATE INDEX idx_learning_reviews_item ON learning_reviews(item_id, reviewed_at DESC);
    `
  },
  {
    version: 8,
    sql: `
      CREATE TABLE habits (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE habit_checkins (
        habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
        day TEXT NOT NULL CHECK (day GLOB '????-??-??'),
        created_at INTEGER NOT NULL,
        PRIMARY KEY (habit_id, day)
      );

      CREATE INDEX idx_habit_checkins_day ON habit_checkins(day);
    `
  },
  {
    version: 9,
    sql: `
      ALTER TABLE tasks ADD COLUMN repeat TEXT
        CHECK (repeat IS NULL OR repeat IN ('daily', 'weekly', 'monthly'));
    `
  },
  {
    version: 10,
    sql: `
      ALTER TABLE tasks ADD COLUMN parent_id TEXT;
      CREATE INDEX idx_tasks_parent ON tasks(parent_id);
    `
  },
  {
    version: 11,
    sql: `
      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        domain TEXT NOT NULL,
        action TEXT NOT NULL,
        target_id TEXT,
        title TEXT,
        source TEXT NOT NULL DEFAULT 'ui',
        detail TEXT
      );

      CREATE INDEX idx_audit_at ON audit_log(at DESC);
      CREATE INDEX idx_audit_target ON audit_log(domain, target_id);
    `
  },
  {
    // 挖空卡：kind 区分卡型，cloze_source 存带 {{c1::…}} 标记的原文。
    // 普通卡两个字段保持默认值，历史数据不需要改写。
    version: 12,
    sql: `
      ALTER TABLE learning_items ADD COLUMN kind TEXT NOT NULL DEFAULT 'basic'
        CHECK (kind IN ('basic', 'cloze'));
      ALTER TABLE learning_items ADD COLUMN cloze_source TEXT NOT NULL DEFAULT '';
      ALTER TABLE learning_items ADD COLUMN note_id TEXT;
      CREATE INDEX idx_learning_note ON learning_items(note_id);
    `
  },
  {
    // 笔记双链：保存时把 [[笔记首行]] 解析成 target_id，title 留快照便于展示。
    version: 13,
    sql: `
      CREATE TABLE note_links (
        source_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        target_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (source_id, title)
      );

      CREATE INDEX idx_note_links_target ON note_links(target_id);
    `
  },
  {
    // FSRS-6 记忆状态：旧卡保持 NULL，首次评分时才建立，不伪造复习历史。
    version: 14,
    sql: `
      ALTER TABLE learning_items ADD COLUMN stability REAL;
      ALTER TABLE learning_items ADD COLUMN difficulty REAL;
      ALTER TABLE learning_items ADD COLUMN lapses INTEGER NOT NULL DEFAULT 0
        CHECK (lapses >= 0);
      ALTER TABLE learning_items ADD COLUMN last_review_on TEXT
        CHECK (last_review_on IS NULL OR last_review_on GLOB '????-??-??');
    `
  },
  {
    // MEM 起步卡：现有库补 8 张管综卡；空库交给渲染层首次种子。
    version: 15,
    sql: memStarterSeedSql()
  },
  {
    // 智能体会话与消息持久化；空库保持为空，演示会话不再写入。
    version: 16,
    sql: `
      CREATE TABLE agent_sessions (
        id TEXT PRIMARY KEY,
        agent TEXT NOT NULL CHECK (agent IN ('claude', 'codex')),
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('run', 'wait', 'idle')),
        resume_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX idx_agent_sessions_updated ON agent_sessions(updated_at DESC);

      CREATE TABLE agent_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
        text TEXT NOT NULL DEFAULT '',
        time_label TEXT NOT NULL DEFAULT '',
        error INTEGER NOT NULL DEFAULT 0 CHECK (error IN (0, 1)),
        tools_json TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX idx_agent_messages_session ON agent_messages(session_id, created_at ASC);
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
  const pending = migrations
    .filter((migration) => migration.version > current)
    .sort((a, b) => a.version - b.version)
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
    pruneBackups(main.file)
  } catch (error) {
    // 备份失败不应阻断迁移，但要在日志里留痕。
    console.error('[db] 迁移前备份失败', error)
  }
}

function pruneBackups(file: string): void {
  const dir = dirname(file)
  const prefix = `${basename(file)}.v`
  const backups = readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && name.endsWith('.bak'))
    .sort()
  for (const name of backups.slice(0, Math.max(0, backups.length - 3))) {
    unlinkSync(join(dir, name))
  }
}
