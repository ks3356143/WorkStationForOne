import type { DatabaseSync } from 'node:sqlite'
import type {
  AgentCreateInput,
  AgentMessageRecord,
  AgentSessionPatch,
  AgentSessionRecord,
  AgentToolRecord
} from '../../shared/ipc'

interface SessionRow {
  id: string
  agent: 'claude' | 'codex'
  title: string
  status: 'run' | 'wait' | 'idle'
  resume_id: string | null
  created_at: number
  updated_at: number
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
  const tools = parseTools(row.tools_json)
  if (tools) message.tools = tools
  return message
}

export class AgentRepository {
  constructor(private readonly db: DatabaseSync) {}

  listSessions(): AgentSessionRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, agent, title, status, resume_id, created_at, updated_at
         FROM agent_sessions ORDER BY updated_at DESC, created_at DESC`
      )
      .all() as unknown as SessionRow[]
    return rows.map(toSession)
  }

  findSession(id: string): AgentSessionRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT id, agent, title, status, resume_id, created_at, updated_at
         FROM agent_sessions WHERE id = ?`
      )
      .get(id) as SessionRow | undefined
    return row ? toSession(row) : undefined
  }

  listMessages(): AgentMessageRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, session_id, role, text, time_label, error, tools_json, created_at
         FROM agent_messages ORDER BY created_at ASC, rowid ASC`
      )
      .all() as unknown as MessageRow[]
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

  /** 进程已退出，重启后不应再显示运行中或等待审批。 */
  resetTransientStatuses(): number {
    const result = this.db
      .prepare("UPDATE agent_sessions SET status = 'idle' WHERE status IN ('run', 'wait')")
      .run()
    return Number(result.changes)
  }
}
