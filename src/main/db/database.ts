import { readdirSync, unlinkSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { MEM_STARTERS } from '../../shared/mem-starters'

export interface Migration {
  version: number
  sql: string
  /** 重建表时临时关闭外键，避免 DROP TABLE 触发其它表的级联删除。 */
  foreignKeysOff?: boolean
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
  },
  {
    // Provider 配置：token 只以加密 BLOB 保存，列表查询不返回。
    version: 17,
    sql: `
      CREATE TABLE provider_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        model TEXT NOT NULL,
        token_encrypted BLOB,
        active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE UNIQUE INDEX idx_provider_active ON provider_profiles(active) WHERE active = 1;
    `
  },
  {
    // MCP 按域权限：只读域名拒绝 Agent 写入；任务默认允许写。
    // 询问模式与写入审批卡尚未实现，这一版只有 read / write 两档。
    version: 18,
    sql: `
      CREATE TABLE mcp_domain_modes (
        domain TEXT PRIMARY KEY CHECK (domain IN ('task', 'habit', 'learning', 'note')),
        mode TEXT NOT NULL CHECK (mode IN ('read', 'write')),
        updated_at INTEGER NOT NULL
      );

      INSERT INTO mcp_domain_modes (domain, mode, updated_at) VALUES
        ('task', 'write', 0),
        ('habit', 'read', 0),
        ('learning', 'read', 0),
        ('note', 'read', 0);
    `
  },
  {
    // 询问模式：SQLite 不能直接改 CHECK，只能重建表；保留用户已有模式。
    version: 19,
    sql: `
      CREATE TABLE mcp_domain_modes_next (
        domain TEXT PRIMARY KEY CHECK (domain IN ('task', 'habit', 'learning', 'note')),
        mode TEXT NOT NULL CHECK (mode IN ('read', 'ask', 'write')),
        updated_at INTEGER NOT NULL
      );

      INSERT INTO mcp_domain_modes_next (domain, mode, updated_at)
        SELECT domain, mode, updated_at FROM mcp_domain_modes;
      DROP TABLE mcp_domain_modes;
      ALTER TABLE mcp_domain_modes_next RENAME TO mcp_domain_modes;
    `
  },
  {
    // Provider 双目标：Claude Code 与 Codex CLI 各自一个 active，互不影响。
    // 旧配置默认归到 claude；Codex 的 wire_api 默认 responses。
    version: 20,
    sql: `
      ALTER TABLE provider_profiles
        ADD COLUMN target TEXT NOT NULL DEFAULT 'claude'
        CHECK (target IN ('claude', 'codex'));
      ALTER TABLE provider_profiles
        ADD COLUMN wire_api TEXT NOT NULL DEFAULT 'responses'
        CHECK (wire_api IN ('responses', 'chat'));

      DROP INDEX idx_provider_active;
      CREATE UNIQUE INDEX idx_provider_active ON provider_profiles(target) WHERE active = 1;
    `
  },
  {
    // 每个 Agent 会话自己的运行目录；空字符串表示尚未选择，不伪造默认路径。
    version: 21,
    sql: `
      ALTER TABLE agent_sessions ADD COLUMN workspace TEXT NOT NULL DEFAULT '';
    `
  },
  {
    // 能力中心：Claude 插件索引、应用私有 MCP Server 与加密的 env / header 值。
    // 只存应用自己的安装记录，不映射 ~/.claude 或 ~/.codex 的全局配置。
    version: 22,
    sql: `
      CREATE TABLE agent_plugins (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        version TEXT NOT NULL DEFAULT '',
        marketplace TEXT NOT NULL DEFAULT '',
        install_path TEXT NOT NULL,
        components TEXT NOT NULL DEFAULT '[]',
        has_hooks INTEGER NOT NULL DEFAULT 0 CHECK (has_hooks IN (0, 1)),
        has_mcp INTEGER NOT NULL DEFAULT 0 CHECK (has_mcp IN (0, 1)),
        enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
        trusted INTEGER NOT NULL DEFAULT 0 CHECK (trusted IN (0, 1)),
        installed_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE mcp_servers (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        transport TEXT NOT NULL CHECK (transport IN ('stdio', 'http')),
        command TEXT NOT NULL DEFAULT '',
        args_json TEXT NOT NULL DEFAULT '[]',
        url TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('catalog', 'manual')),
        catalog_id TEXT NOT NULL DEFAULT '',
        version TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
        trusted INTEGER NOT NULL DEFAULT 0 CHECK (trusted IN (0, 1)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE mcp_server_secrets (
        server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('env', 'header')),
        key TEXT NOT NULL,
        value_encrypted BLOB NOT NULL,
        PRIMARY KEY (server_id, kind, key)
      );
    `
  },
  {
    // 外部 MCP 最近一次连接测试的工具清单与错误；改配置后由仓储清空重测。
    version: 23,
    sql: `
      ALTER TABLE mcp_servers ADD COLUMN tools_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE mcp_servers ADD COLUMN last_test_at INTEGER;
      ALTER TABLE mcp_servers ADD COLUMN last_error TEXT NOT NULL DEFAULT '';
    `
  },
  {
    // MCP 工具级权限：allow 自动批准、ask 走审批卡、deny 直接拒绝。
    // 测试连接时同步工具元数据；改 Server 配置会清空旧工具。
    version: 24,
    sql: `
      CREATE TABLE mcp_server_tools (
        server_id TEXT NOT NULL REFERENCES mcp_servers(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        read_only INTEGER NOT NULL DEFAULT 0 CHECK (read_only IN (0, 1)),
        approval TEXT NOT NULL DEFAULT 'ask' CHECK (approval IN ('allow', 'ask', 'deny')),
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (server_id, name)
      );
    `
  },
  {
    // 工作区预设与 Agent 用量；用量记录独立于会话，避免删会话丢历史。
    version: 25,
    sql: `
      CREATE TABLE agent_presets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        agent TEXT NOT NULL CHECK (agent IN ('claude', 'codex')),
        workspace TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE agent_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        ok INTEGER,
        cancelled INTEGER NOT NULL DEFAULT 0 CHECK (cancelled IN (0, 1)),
        cost_usd REAL,
        duration_ms INTEGER,
        turns INTEGER
      );

      CREATE INDEX idx_agent_runs_started ON agent_runs(started_at DESC);
    `
  },
  {
    // 导入历史标记：app 为本应用产生，import 为外部 CLI JSONL 只读导入。
    version: 26,
    sql: `
      ALTER TABLE agent_messages ADD COLUMN origin TEXT NOT NULL DEFAULT 'app';
    `
  },
  {
    // 审批规则：只保存工作区级的精确工具放行；会话级规则只存在内存。
    version: 27,
    sql: `
      CREATE TABLE approval_rules (
        id TEXT PRIMARY KEY,
        agent TEXT NOT NULL CHECK (agent IN ('claude', 'codex')),
        workspace TEXT NOT NULL,
        workspace_key TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER,
        UNIQUE (agent, workspace_key, tool_name)
      );

      CREATE INDEX idx_approval_rules_used
        ON approval_rules(last_used_at DESC, created_at DESC);
    `
  },
  {
    // 外部 MCP 的 Agent 归属：both 表示 Claude 与 Codex 都下发。
    // 旧库里的 Server 一律视为 both，不改变既有会话行为。
    version: 28,
    sql: `
      ALTER TABLE mcp_servers ADD COLUMN targets TEXT NOT NULL DEFAULT 'both'
        CHECK (targets IN ('both', 'claude', 'codex'));
    `
  },
  {
    // 内置数据工具的单独开关：只记录被关闭的工具，缺行即视为启用。
    version: 29,
    sql: `
      CREATE TABLE builtin_tool_settings (
        name TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        updated_at INTEGER NOT NULL
      );
    `
  },
  {
    // 插件源与 Agent 归属：同一插件可在 Claude / Codex 各装一次。
    // 旧库既有插件一律归 claude，source_id 留空表示来源未知。
    // 主键从 id 改成 (agent, id)，SQLite 不能改主键，只能重建表并搬数据。
    version: 30,
    sql: `
      CREATE TABLE plugin_sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL CHECK (kind IN ('official', 'git')),
        url TEXT NOT NULL,
        ref TEXT NOT NULL DEFAULT '',
        root TEXT NOT NULL,
        last_synced_at INTEGER,
        last_error TEXT NOT NULL DEFAULT '',
        plugin_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      ALTER TABLE agent_plugins RENAME TO agent_plugins_v29;

      CREATE TABLE agent_plugins (
        id TEXT NOT NULL,
        agent TEXT NOT NULL DEFAULT 'claude' CHECK (agent IN ('claude', 'codex')),
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        version TEXT NOT NULL DEFAULT '',
        marketplace TEXT NOT NULL DEFAULT '',
        install_path TEXT NOT NULL,
        components TEXT NOT NULL DEFAULT '[]',
        has_hooks INTEGER NOT NULL DEFAULT 0 CHECK (has_hooks IN (0, 1)),
        has_mcp INTEGER NOT NULL DEFAULT 0 CHECK (has_mcp IN (0, 1)),
        enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
        trusted INTEGER NOT NULL DEFAULT 0 CHECK (trusted IN (0, 1)),
        source_id TEXT NOT NULL DEFAULT '',
        installed_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (agent, id)
      );

      INSERT INTO agent_plugins
        (id, agent, name, description, version, marketplace, install_path, components,
         has_hooks, has_mcp, enabled, trusted, source_id, installed_at, updated_at)
      SELECT id, 'claude', name, description, version, marketplace, install_path, components,
             has_hooks, has_mcp, enabled, trusted, '', installed_at, updated_at
      FROM agent_plugins_v29;

      DROP TABLE agent_plugins_v29;
    `
  },
  {
    // 远程 MCP 的 OAuth：认证方式与授权状态分表存，Token 仍是 safeStorage 加密 BLOB。
    // 旧 Server 一律 headers，行为不变；OAuth 记录随 Server 删除。
    version: 31,
    sql: `
      ALTER TABLE mcp_servers ADD COLUMN auth TEXT NOT NULL DEFAULT 'headers'
        CHECK (auth IN ('headers', 'oauth'));

      CREATE TABLE mcp_oauth (
        server_id TEXT PRIMARY KEY REFERENCES mcp_servers(id) ON DELETE CASCADE,
        issuer TEXT NOT NULL DEFAULT '',
        resource TEXT NOT NULL DEFAULT '',
        client_id TEXT NOT NULL DEFAULT '',
        client_secret_encrypted BLOB,
        authorization_endpoint TEXT NOT NULL DEFAULT '',
        token_endpoint TEXT NOT NULL DEFAULT '',
        registration_endpoint TEXT NOT NULL DEFAULT '',
        scopes TEXT NOT NULL DEFAULT '',
        token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
        access_token_encrypted BLOB,
        refresh_token_encrypted BLOB,
        expires_at INTEGER,
        last_error TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
      );
    `
  },
  {
    // 会话置顶只影响列表排序，不改变状态、消息或运行。
    version: 32,
    sql: `
      ALTER TABLE agent_sessions ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0
        CHECK (pinned IN (0, 1));
    `
  },
  {
    // 归档只影响列表可见性；消息、运行历史与工作区都不动，可随时取消。
    version: 33,
    sql: `
      ALTER TABLE agent_sessions ADD COLUMN archived INTEGER NOT NULL DEFAULT 0
        CHECK (archived IN (0, 1));
    `
  },
  {
    // 提醒静音按「任务 + 本地日期」记录：同一天改时间也不再提醒，换天自动恢复。
    version: 34,
    sql: `
      CREATE TABLE reminder_mutes (
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (task_id, day)
      );

      CREATE INDEX idx_reminder_mutes_day ON reminder_mutes(day);
    `
  },
  {
    // 下一次 --resume 是否要加 --fork-session；真分叉拿到新 CLI session id 后清除。
    version: 35,
    sql: `
      ALTER TABLE agent_sessions ADD COLUMN pending_fork INTEGER NOT NULL DEFAULT 0
        CHECK (pending_fork IN (0, 1));
    `
  },
  {
    // Codex 任意轮次分叉：消息记录所属 turn，会话记录待使用的 lastTurnId。
    version: 36,
    sql: `
      ALTER TABLE agent_sessions ADD COLUMN fork_turn_id TEXT;
      ALTER TABLE agent_messages ADD COLUMN turn_id TEXT;
    `
  },
  {
    // @ 文件上下文：消息只存工作区相对路径，文件内容不落库。
    version: 37,
    sql: `
      ALTER TABLE agent_messages ADD COLUMN context_files TEXT;
    `
  },
  {
    // 计划模式：只读调查并给出方案，执行前不写文件。
    version: 38,
    sql: `
      ALTER TABLE agent_sessions ADD COLUMN plan_mode INTEGER NOT NULL DEFAULT 0;
    `
  },
  {
    // 检查点：回合前文件快照；files 只存工作区相对路径与原内容。
    version: 39,
    sql: `
      CREATE TABLE agent_checkpoints (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
        run_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        files_json TEXT NOT NULL,
        restored_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX idx_agent_checkpoints_session
        ON agent_checkpoints(session_id, created_at DESC);
    `
  },
  {
    // 图片输入：消息只存私有目录里的引用，图片本体不落库。
    version: 40,
    sql: `
      ALTER TABLE agent_messages ADD COLUMN images_json TEXT;
    `
  },
  {
    // 工具面：按 Agent 保存原生工具开关与 MCP / 技能排序。
    version: 41,
    sql: `
      CREATE TABLE agent_tool_prefs (
        agent TEXT NOT NULL CHECK (agent IN ('claude', 'codex')),
        tool_key TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        sort_order INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (agent, tool_key)
      );
    `
  },
  {
    // 首选标记：提示词里分成「首选 / 其它启用」，首选优先于 CLI 原生工具。
    version: 42,
    sql: `
      ALTER TABLE agent_tool_prefs
        ADD COLUMN preferred INTEGER NOT NULL DEFAULT 0 CHECK (preferred IN (0, 1));
    `
  },
  {
    // 重复规则扩展：SQLite 不能改 CHECK，只能重建 tasks。
    // 关闭外键后再 DROP，避免 reminder_mutes 的 ON DELETE CASCADE 清空静音记录。
    version: 43,
    foreignKeysOff: true,
    sql: `
      CREATE TABLE tasks_new (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        time_label TEXT NOT NULL DEFAULT '—',
        tag TEXT,
        tone TEXT CHECK (tone IS NULL OR tone IN ('agent', 'hot')),
        done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        notes TEXT NOT NULL DEFAULT '',
        due_date TEXT CHECK (due_date IS NULL OR due_date GLOB '????-??-??'),
        priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 3),
        list TEXT,
        deleted_at INTEGER,
        planned_for TEXT CHECK (planned_for IS NULL OR planned_for GLOB '????-??-??'),
        estimate_minutes INTEGER NOT NULL DEFAULT 0
          CHECK (estimate_minutes BETWEEN 0 AND 480),
        repeat TEXT CHECK (
          repeat IS NULL
          OR repeat IN ('daily', 'weekly', 'monthly', 'weekday')
          OR repeat GLOB 'every:[0-9]*'
          OR repeat GLOB 'monthly-nth:[1-4]:[0-6]'
        ),
        parent_id TEXT
      );
      INSERT INTO tasks_new (
        id, title, time_label, tag, tone, done, sort_order, created_at, updated_at,
        completed_at, notes, due_date, priority, list, deleted_at, planned_for,
        estimate_minutes, repeat, parent_id
      )
      SELECT
        id, title, time_label, tag, tone, done, sort_order, created_at, updated_at,
        completed_at, notes, due_date, priority, list, deleted_at, planned_for,
        estimate_minutes, repeat, parent_id
      FROM tasks;
      DROP TABLE tasks;
      ALTER TABLE tasks_new RENAME TO tasks;
      CREATE INDEX idx_tasks_done ON tasks(done, sort_order);
      CREATE INDEX idx_tasks_due ON tasks(done, due_date, sort_order);
      CREATE INDEX idx_tasks_list ON tasks(done, list);
      CREATE INDEX idx_tasks_live ON tasks(deleted_at, sort_order);
      CREATE INDEX idx_tasks_parent ON tasks(parent_id);
      CREATE INDEX idx_tasks_planned ON tasks(planned_for, deleted_at);
    `
  },
  {
    // 首选用途说明：只进入首选分组，每轮提示词都带，所以存清洗后的短文本。
    version: 44,
    sql: `
      ALTER TABLE agent_tool_prefs
        ADD COLUMN note TEXT NOT NULL DEFAULT '';
    `
  },
  {
    // 回合改动复盘：助手消息关联产生它的运行，用于匹配检查点。
    version: 45,
    sql: `
      ALTER TABLE agent_messages ADD COLUMN run_id TEXT;
    `
  },
  {
    // 消息模型标签：记录产生该回复的真实模型；旧消息留空回退默认标签。
    version: 46,
    sql: `
      ALTER TABLE agent_messages ADD COLUMN model TEXT;
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
    const fkOff = migration.foreignKeysOff === true
    // PRAGMA foreign_keys 只能在事务外切换；重建表时必须先关，否则 DROP 会级联删数据。
    if (fkOff) db.exec('PRAGMA foreign_keys = OFF')
    db.exec('BEGIN')
    try {
      db.exec(migration.sql)
      if (fkOff) {
        const violations = db.prepare('PRAGMA foreign_key_check').all()
        if (violations.length > 0) throw new Error('迁移后外键校验失败')
      }
      db.exec(`PRAGMA user_version = ${migration.version}`)
      db.exec('COMMIT')
      current = migration.version
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    } finally {
      if (fkOff) db.exec('PRAGMA foreign_keys = ON')
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
