import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type {
  AgentCreateInput,
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
  workspace: string
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

interface MessageRow {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  text: string
  time_label: string
  error: number
  tools_json: string | null
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
  if (row.workspace) session.workspace = row.workspace
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
  if (row.origin === 'import') message.origin = 'import'
  const tools = parseTools(row.tools_json)
  if (tools) message.tools = tools
  return message
}

export class AgentRepository {
  constructor(private readonly db: DatabaseSync) {}

  listSessions(): AgentSessionRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, agent, title, status, resume_id, workspace, created_at, updated_at
         FROM agent_sessions ORDER BY updated_at DESC, created_at DESC`
      )
      .all() as unknown as SessionRow[]
    return rows.map(toSession)
  }

  findSession(id: string): AgentSessionRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT id, agent, title, status, resume_id, workspace, created_at, updated_at
         FROM agent_sessions WHERE id = ?`
      )
      .get(id) as SessionRow | undefined
    return row ? toSession(row) : undefined
  }

  listMessages(): AgentMessageRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, session_id, role, text, time_label, error, tools_json, created_at, origin
         FROM agent_messages ORDER BY created_at ASC, rowid ASC`
      )
      .all() as unknown as MessageRow[]
    return rows.map(toMessage)
  }

  listMessagesForSession(sessionId: string): AgentMessageRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, session_id, role, text, time_label, error, tools_json, created_at, origin
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
    const values: (string | number)[] = []
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
    if (patch.workspace !== undefined) {
      assignments.push('workspace = ?')
      values.push(patch.workspace)
    }
    if (assignments.length === 0) return this.findSession(id)

    assignments.push('updated_at = ?')
    values.push(Date.now(), id)
    this.db
      .prepare(`UPDATE agent_sessions SET ${assignments.join(', ')} WHERE id = ?`)
      .run(...values)
    return this.findSession(id)
  }

  /** 用户消息与助手最终消息都走 upsert：流式结束时同 id 覆盖中间态。 */
  saveMessage(message: AgentMessageRecord): void {
    const tools = message.tools ? JSON.stringify(message.tools) : null
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO agent_messages
          (id, session_id, role, text, time_label, error, tools_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           text = excluded.text,
           time_label = excluded.time_label,
           error = excluded.error,
           tools_json = excluded.tools_json`
      )
      .run(
        message.id,
        message.sessionId,
        message.role,
        message.text,
        message.timeLabel,
        message.error ? 1 : 0,
        tools,
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
        (id, session_id, role, text, time_label, error, tools_json, created_at, origin)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'import')
       ON CONFLICT(id) DO UPDATE SET
         text = excluded.text,
         time_label = excluded.time_label,
         error = excluded.error,
         tools_json = excluded.tools_json,
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
