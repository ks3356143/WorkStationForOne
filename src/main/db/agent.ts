import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  AgentCreateInput,
  AgentCheckpointFile,
  AgentCheckpointRecord,
  AgentImageRef,
  AgentForkResult,
  AgentSessionSearchHit,
  AgentMessageRecord,
  AgentPresetInput,
  AgentPresetRecord,
  AgentRunRecord,
  AgentSessionPatch,
  AgentSessionRecord,
  AgentToolRecord
} from '../../shared/ipc'
import { runInTransaction } from './transaction'

interface SessionRow {
  id: string
  agent: 'claude' | 'codex'
  title: string
  status: 'run' | 'wait' | 'idle'
  resume_id: string | null
  pending_fork: number
  fork_turn_id: string | null
  workspace: string
  pinned: number
  archived: number
  plan_mode: number
  created_at: number
  updated_at: number
}

interface PresetRow {
  id: string
  name: string
  agent: 'claude' | 'codex'
  workspace: string
  created_at: number
  updated_at: number
}

interface RunRow {
  id: string
  session_id: string
  started_at: number
  finished_at: number | null
  ok: number | null
  cancelled: number
  cost_usd: number | null
  duration_ms: number | null
  turns: number | null
}

export interface AgentRunFinish {
  ok: boolean
  cancelled: boolean
  costUsd?: number
  durationMs?: number
  turns?: number
}

interface CheckpointRow {
  id: string
  session_id: string
  run_id: string
  summary: string
  files_json: string
  restored_at: number | null
  created_at: number
}

const MAX_CHECKPOINTS_PER_SESSION = 50
const MAX_CHECKPOINT_BYTES_PER_SESSION = 32 * 1024 * 1024

export interface AgentRepositoryLimits {
  maxCheckpoints?: number
  maxCheckpointBytes?: number
}

function toCheckpoint(row: CheckpointRow): AgentCheckpointRecord {
  let files: AgentCheckpointFile[] = []
  try {
    const parsed: unknown = JSON.parse(row.files_json)
    if (Array.isArray(parsed)) files = parsed as AgentCheckpointFile[]
  } catch {
    files = []
  }
  return {
    id: row.id,
    sessionId: row.session_id,
    runId: row.run_id,
    summary: row.summary,
    files,
    createdAt: row.created_at,
    ...(row.restored_at ? { restoredAt: row.restored_at } : {})
  }
}

interface MessageRow {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  text: string
  time_label: string
  error: number
  tools_json: string | null
  turn_id: string | null
  context_files: string | null
  images_json: string | null
  created_at: number
  origin: 'app' | 'import'
}

function toSession(row: SessionRow): AgentSessionRecord {
  const session: AgentSessionRecord = {
    id: row.id,
    agent: row.agent,
    title: row.title,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
  if (row.resume_id) session.resumeId = row.resume_id
  if (row.pending_fork === 1) session.pendingFork = true
  if (row.fork_turn_id) session.forkTurnId = row.fork_turn_id
  if (row.workspace) session.workspace = row.workspace
  if (row.pinned === 1) session.pinned = true
  if (row.archived === 1) session.archived = true
  if (row.plan_mode === 1) session.planMode = true
  return session
}

function parseTools(raw: string | null): AgentToolRecord[] | undefined {
  if (!raw) return undefined
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) ? (value as AgentToolRecord[]) : undefined
  } catch {
    return undefined
  }
}

function parseContextFiles(raw: string | null): string[] | undefined {
  if (!raw) return undefined
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return undefined
    const files = value.filter((item): item is string => typeof item === 'string')
    return files.length > 0 ? files : undefined
  } catch {
    return undefined
  }
}

function toMessage(row: MessageRow): AgentMessageRecord {
  const message: AgentMessageRecord = {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    text: row.text,
    timeLabel: row.time_label,
    createdAt: row.created_at
  }
  if (row.error === 1) message.error = true
  if (row.turn_id) message.turnId = row.turn_id
  if (row.origin === 'import') message.origin = 'import'
  const tools = parseTools(row.tools_json)
  if (tools) message.tools = tools
  const contextFiles = parseContextFiles(row.context_files)
  if (contextFiles) message.contextFiles = contextFiles
  const images = parseImages(row.images_json)
  if (images) message.images = images
  return message
}

function parseImages(raw: string | null): AgentImageRef[] | undefined {
  if (!raw) return undefined
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return undefined
    const images = value.filter(
      (item): item is AgentImageRef =>
        typeof item === 'object' && item !== null && typeof (item as AgentImageRef).id === 'string'
    )
    return images.length > 0 ? images : undefined
  } catch {
    return undefined
  }
}

function dedupeImages(rows: { images_json: string | null }[]): AgentImageRef[] {
  const seen = new Set<string>()
  const images: AgentImageRef[] = []
  for (const row of rows) {
    for (const image of parseImages(row.images_json) ?? []) {
      if (seen.has(image.id)) continue
      seen.add(image.id)
      images.push(image)
    }
  }
  return images
}

export class AgentRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly limits: AgentRepositoryLimits = {}
  ) {}

  /** 标题与消息正文一起搜；LIKE 转义 % _ \，CJK 直接子串匹配即可。 */
  searchSessions(query: string, limit = 40): AgentSessionSearchHit[] {
    const escaped = query.slice(0, 80).replace(/[\\%_]/g, (char) => `\\${char}`)
    const pattern = `%${escaped}%`
    const rows = this.db
      .prepare(
        `SELECT s.id, s.agent, s.title, s.status, s.resume_id, s.pending_fork, s.fork_turn_id,
           s.workspace, s.pinned, s.archived, s.plan_mode, s.created_at, s.updated_at,
           (SELECT m.id FROM agent_messages m
            WHERE m.session_id = s.id AND m.text LIKE ? ESCAPE '\\'
            ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS message_id,
           (SELECT m.text FROM agent_messages m
            WHERE m.session_id = s.id AND m.text LIKE ? ESCAPE '\\'
            ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS snippet,
           CASE WHEN s.title LIKE ? ESCAPE '\\' THEN 'title' ELSE 'message' END AS matched_in
         FROM agent_sessions s
         WHERE s.title LIKE ? ESCAPE '\\'
            OR EXISTS (SELECT 1 FROM agent_messages m WHERE m.session_id = s.id AND m.text LIKE ? ESCAPE '\\')
         ORDER BY s.pinned DESC, s.updated_at DESC, s.created_at DESC
         LIMIT ?`
      )
      .all(pattern, pattern, pattern, pattern, pattern, limit) as unknown as (SessionRow & {
      message_id: string | null
      snippet: string | null
      matched_in: 'title' | 'message'
    })[]
    return rows.map((row) => ({
      session: toSession(row),
      snippet: (row.snippet ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
      messageId: row.matched_in === 'title' ? null : (row.message_id ?? null),
      matchedIn: row.matched_in === 'title' ? 'title' : 'message'
    }))
  }

  listSessions(): AgentSessionRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, agent, title, status, resume_id, pending_fork, fork_turn_id, workspace,
           pinned, archived, plan_mode, created_at, updated_at
         FROM agent_sessions ORDER BY pinned DESC, updated_at DESC, created_at DESC`
      )
      .all() as unknown as SessionRow[]
    return rows.map(toSession)
  }

  findSession(id: string): AgentSessionRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT id, agent, title, status, resume_id, pending_fork, fork_turn_id, workspace,
           pinned, archived, plan_mode, created_at, updated_at
         FROM agent_sessions WHERE id = ?`
      )
      .get(id) as SessionRow | undefined
    return row ? toSession(row) : undefined
  }

  /** 启动时只需要数量；正文在切换会话时再取。 */
  messageCounts(): Record<string, number> {
    const rows = this.db
      .prepare('SELECT session_id, COUNT(*) AS n FROM agent_messages GROUP BY session_id')
      .all() as unknown as { session_id: string; n: number }[]
    return Object.fromEntries(rows.map((row) => [row.session_id, Number(row.n)]))
  }

  listMessages(): AgentMessageRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, session_id, role, text, time_label, error, tools_json, turn_id,
           context_files, images_json, created_at, origin
         FROM agent_messages ORDER BY created_at ASC, rowid ASC`
      )
      .all() as unknown as MessageRow[]
    return rows.map(toMessage)
  }

  listMessagesForSession(sessionId: string): AgentMessageRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, session_id, role, text, time_label, error, tools_json, turn_id,
           context_files, images_json, created_at, origin
         FROM agent_messages WHERE session_id = ? ORDER BY created_at ASC, rowid ASC`
      )
      .all(sessionId) as unknown as MessageRow[]
    return rows.map(toMessage)
  }

  createSession(input: AgentCreateInput): AgentSessionRecord {
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO agent_sessions (id, agent, title, status, created_at, updated_at)
         VALUES (?, ?, ?, 'idle', ?, ?)`
      )
      .run(input.id, input.agent, input.title, now, now)
    return (
      this.findSession(input.id) ?? {
        id: input.id,
        agent: input.agent,
        title: input.title,
        status: 'idle',
        createdAt: now,
        updatedAt: now
      }
    )
  }

  updateSession(id: string, patch: AgentSessionPatch): AgentSessionRecord | undefined {
    const assignments: string[] = []
    const values: (string | number | null)[] = []
    if (patch.title !== undefined) {
      assignments.push('title = ?')
      values.push(patch.title)
    }
    if (patch.status !== undefined) {
      assignments.push('status = ?')
      values.push(patch.status)
    }
    if (patch.resumeId !== undefined) {
      assignments.push('resume_id = ?')
      values.push(patch.resumeId)
    }
    if (patch.pendingFork !== undefined) {
      assignments.push('pending_fork = ?')
      values.push(patch.pendingFork ? 1 : 0)
    }
    if (patch.forkTurnId !== undefined) {
      assignments.push('fork_turn_id = ?')
      values.push(patch.forkTurnId)
    }
    if (patch.workspace !== undefined) {
      assignments.push('workspace = ?')
      values.push(patch.workspace)
    }
    if (patch.pinned !== undefined) {
      assignments.push('pinned = ?')
      values.push(patch.pinned ? 1 : 0)
    }
    if (patch.archived !== undefined) {
      assignments.push('archived = ?')
      values.push(patch.archived ? 1 : 0)
    }
    if (patch.planMode !== undefined) {
      assignments.push('plan_mode = ?')
      values.push(patch.planMode ? 1 : 0)
    }
    if (assignments.length === 0) return this.findSession(id)

    assignments.push('updated_at = ?')
    values.push(Date.now(), id)
    this.db
      .prepare(`UPDATE agent_sessions SET ${assignments.join(', ')} WHERE id = ?`)
      .run(...values)
    return this.findSession(id)
  }

  /** 消息由外键 ON DELETE CASCADE 一并清理；agent_runs 保留为用量历史。 */
  removeSession(id: string): boolean {
    const result = this.db.prepare('DELETE FROM agent_sessions WHERE id = ?').run(id)
    return Number(result.changes) > 0
  }

  /** 从消息处分叉：先复制对话；是否继承源 resume_id 由 IPC 层按 CLI 能力决定。 */
  forkSession(input: {
    sourceId: string
    messageId: string
    id: string
    title: string
  }): Omit<AgentForkResult, 'mode'> | null {
    const source = this.findSession(input.sourceId)
    if (!source) return null
    const messages = this.listMessagesForSession(input.sourceId)
    const index = messages.findIndex((message) => message.id === input.messageId)
    if (index < 0) return null
    const now = Date.now()
    runInTransaction(this.db, () => {
      this.db
        .prepare(
          `INSERT INTO agent_sessions (id, agent, title, status, workspace, created_at, updated_at)
           VALUES (?, ?, ?, 'idle', ?, ?, ?)`
        )
        .run(input.id, source.agent, input.title, source.workspace ?? '', now, now)
      const insert = this.db.prepare(
        `INSERT INTO agent_messages
          (id, session_id, role, text, time_label, error, tools_json, turn_id, context_files,
           images_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
      )
      for (let cursor = 0; cursor <= index; cursor += 1) {
        const message = messages[cursor]
        if (!message) continue
        insert.run(
          `${input.id}-m${cursor + 1}`,
          input.id,
          message.role,
          message.text,
          message.timeLabel,
          message.error ? 1 : 0,
          message.tools ? JSON.stringify(message.tools) : null,
          message.contextFiles ? JSON.stringify(message.contextFiles) : null,
          message.images ? JSON.stringify(message.images) : null,
          message.createdAt
        )
      }
    })
    const session = this.findSession(input.id)
    if (!session) return null
    return { session, messages: this.listMessagesForSession(input.id) }
  }

  /** 用户消息与助手最终消息都走 upsert：流式结束时同 id 覆盖中间态。 */
  saveMessage(message: AgentMessageRecord): void {
    const tools = message.tools ? JSON.stringify(message.tools) : null
    const contextFiles = message.contextFiles ? JSON.stringify(message.contextFiles) : null
    const images = message.images ? JSON.stringify(message.images) : null
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO agent_messages
          (id, session_id, role, text, time_label, error, tools_json, turn_id, context_files,
           images_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           text = excluded.text,
           time_label = excluded.time_label,
           error = excluded.error,
           tools_json = excluded.tools_json,
           turn_id = excluded.turn_id,
           context_files = excluded.context_files,
           images_json = excluded.images_json`
      )
      .run(
        message.id,
        message.sessionId,
        message.role,
        message.text,
        message.timeLabel,
        message.error ? 1 : 0,
        tools,
        message.turnId ?? null,
        contextFiles,
        images,
        message.createdAt
      )
    this.db
      .prepare('UPDATE agent_sessions SET updated_at = ? WHERE id = ?')
      .run(now, message.sessionId)
  }

  /** 本机 JSONL 历史批量导入：固定 id 幂等，origin 固定为 import。 */
  importMessages(sessionId: string, messages: AgentMessageRecord[]): void {
    const list = messages.filter((message) => message.sessionId === sessionId)
    if (list.length === 0) return
    const insert = this.db.prepare(
      `INSERT INTO agent_messages
        (id, session_id, role, text, time_label, error, tools_json, turn_id, created_at, origin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'import')
       ON CONFLICT(id) DO UPDATE SET
         text = excluded.text,
         time_label = excluded.time_label,
         error = excluded.error,
         tools_json = excluded.tools_json,
         turn_id = excluded.turn_id,
         created_at = excluded.created_at,
         origin = 'import'`
    )
    runInTransaction(this.db, () => {
      for (const message of list) {
        insert.run(
          message.id,
          sessionId,
          message.role,
          message.text,
          message.timeLabel,
          message.error ? 1 : 0,
          message.tools ? JSON.stringify(message.tools) : null,
          message.turnId ?? null,
          message.createdAt
        )
      }
    })
  }

  listPresets(): AgentPresetRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, agent, workspace, created_at, updated_at
         FROM agent_presets ORDER BY updated_at DESC`
      )
      .all() as unknown as PresetRow[]
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      agent: row.agent,
      workspace: row.workspace,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }))
  }

  savePreset(input: AgentPresetInput): AgentPresetRecord {
    const id = `preset-${randomUUID()}`
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO agent_presets (id, name, agent, workspace, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, input.name.trim(), input.agent, input.workspace, now, now)
    return {
      id,
      name: input.name.trim(),
      agent: input.agent,
      workspace: input.workspace,
      createdAt: now,
      updatedAt: now
    }
  }

  removePreset(id: string): void {
    this.db.prepare('DELETE FROM agent_presets WHERE id = ?').run(id)
  }

  saveCheckpoint(input: {
    id: string
    sessionId: string
    runId: string
    summary: string
    files: AgentCheckpointFile[]
    createdAt: number
  }): void {
    this.db
      .prepare(
        `INSERT INTO agent_checkpoints
          (id, session_id, run_id, summary, files_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.sessionId,
        input.runId,
        input.summary,
        JSON.stringify(input.files),
        input.createdAt
      )
    // 检查点保存文件原内容：既限制条数，也限制每个会话的总字节数。
    runInTransaction(this.db, () => {
      this.db
        .prepare(
          `DELETE FROM agent_checkpoints
           WHERE session_id = ? AND id NOT IN (
             SELECT id FROM agent_checkpoints WHERE session_id = ?
             ORDER BY created_at DESC, rowid DESC LIMIT ?
           )`
        )
        .run(
          input.sessionId,
          input.sessionId,
          this.limits.maxCheckpoints ?? MAX_CHECKPOINTS_PER_SESSION
        )
      const rows = this.db
        .prepare(
          `SELECT id, LENGTH(files_json) AS bytes FROM agent_checkpoints
           WHERE session_id = ? ORDER BY created_at DESC, rowid DESC`
        )
        .all(input.sessionId) as unknown as { id: string; bytes: number }[]
      const maxBytes = this.limits.maxCheckpointBytes ?? MAX_CHECKPOINT_BYTES_PER_SESSION
      let total = 0
      const excess: string[] = []
      rows.forEach((row, index) => {
        total += Number(row.bytes ?? 0)
        // 最新一条即使自己超预算也保留，否则回退会连最近一次改动都看不到。
        if (index > 0 && total > maxBytes) excess.push(row.id)
      })
      if (excess.length > 0) {
        const placeholders = excess.map(() => '?').join(', ')
        this.db
          .prepare(`DELETE FROM agent_checkpoints WHERE id IN (${placeholders})`)
          .run(...excess)
      }
    })
  }

  listCheckpoints(sessionId: string): AgentCheckpointRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, session_id, run_id, summary, files_json, restored_at, created_at
         FROM agent_checkpoints WHERE session_id = ?
         ORDER BY created_at DESC, rowid DESC`
      )
      .all(sessionId) as unknown as CheckpointRow[]
    return rows.map(toCheckpoint)
  }

  findCheckpoint(id: string): AgentCheckpointRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT id, session_id, run_id, summary, files_json, restored_at, created_at
         FROM agent_checkpoints WHERE id = ?`
      )
      .get(id) as CheckpointRow | undefined
    return row ? toCheckpoint(row) : undefined
  }

  markCheckpointRestored(id: string, at: number): void {
    this.db.prepare('UPDATE agent_checkpoints SET restored_at = ? WHERE id = ?').run(at, id)
  }

  /** 会话内引用到的图片；用于删除会话时清理孤儿文件。 */
  listImageRefsForSession(sessionId: string): AgentImageRef[] {
    const rows = this.db
      .prepare('SELECT images_json FROM agent_messages WHERE session_id = ?')
      .all(sessionId) as unknown as { images_json: string | null }[]
    return dedupeImages(rows)
  }

  listImageRefs(): AgentImageRef[] {
    const rows = this.db
      .prepare('SELECT images_json FROM agent_messages WHERE images_json IS NOT NULL')
      .all() as unknown as { images_json: string | null }[]
    return dedupeImages(rows)
  }

  recordRunStart(id: string, sessionId: string, startedAt: number): void {
    this.db
      .prepare(
        `INSERT INTO agent_runs (id, session_id, started_at, cancelled)
         VALUES (?, ?, ?, 0)
         ON CONFLICT(id) DO NOTHING`
      )
      .run(id, sessionId, startedAt)
  }

  finishRun(id: string, info: AgentRunFinish): void {
    this.db
      .prepare(
        `UPDATE agent_runs SET
           finished_at = ?, ok = ?, cancelled = ?, cost_usd = ?, duration_ms = ?, turns = ?
         WHERE id = ?`
      )
      .run(
        Date.now(),
        info.ok ? 1 : 0,
        info.cancelled ? 1 : 0,
        info.costUsd ?? null,
        info.durationMs ?? null,
        info.turns ?? null,
        id
      )
  }

  listRuns(since: number): AgentRunRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, session_id, started_at, finished_at, ok, cancelled,
                cost_usd, duration_ms, turns
         FROM agent_runs WHERE started_at >= ? ORDER BY started_at DESC`
      )
      .all(since) as unknown as RunRow[]
    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      startedAt: row.started_at,
      finishedAt: row.finished_at ?? null,
      ok: row.ok === null ? null : row.ok === 1,
      cancelled: row.cancelled === 1,
      costUsd: row.cost_usd ?? null,
      durationMs: row.duration_ms ?? null,
      turns: row.turns ?? null
    }))
  }

  /** 进程已退出，重启后不应再显示运行中或等待审批。 */
  resetTransientStatuses(): number {
    const result = this.db
      .prepare("UPDATE agent_sessions SET status = 'idle' WHERE status IN ('run', 'wait')")
      .run()
    return Number(result.changes)
  }
}
