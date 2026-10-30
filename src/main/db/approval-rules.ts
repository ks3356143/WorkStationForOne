import type { DatabaseSync } from 'node:sqlite'
import type { ApprovalAgent } from '../../shared/approval-rules'
import type { ApprovalRuleRecord } from '../../shared/ipc'

interface ApprovalRuleRow {
  id: string
  agent: ApprovalAgent
  workspace: string
  tool_name: string
  created_at: number
  last_used_at: number | null
}

export interface ApprovalRuleInput {
  id: string
  agent: ApprovalAgent
  workspace: string
  workspaceKey: string
  toolName: string
  now: number
}

function toRecord(row: ApprovalRuleRow): ApprovalRuleRecord {
  return {
    id: row.id,
    agent: row.agent,
    workspace: row.workspace,
    toolName: row.tool_name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at
  }
}

const SELECT = `SELECT id, agent, workspace, tool_name, created_at, last_used_at
  FROM approval_rules`

export class ApprovalRuleRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(): ApprovalRuleRecord[] {
    const rows = this.db
      .prepare(
        `${SELECT} ORDER BY COALESCE(last_used_at, created_at) DESC, created_at DESC, id ASC`
      )
      .all() as unknown as ApprovalRuleRow[]
    return rows.map(toRecord)
  }

  find(
    agent: ApprovalAgent,
    workspaceKey: string,
    toolName: string
  ): ApprovalRuleRecord | undefined {
    const row = this.db
      .prepare(`${SELECT} WHERE agent = ? AND workspace_key = ? AND tool_name = ?`)
      .get(agent, workspaceKey, toolName) as unknown as ApprovalRuleRow | undefined
    return row ? toRecord(row) : undefined
  }

  upsert(input: ApprovalRuleInput): ApprovalRuleRecord {
    const existing = this.find(input.agent, input.workspaceKey, input.toolName)
    if (existing) {
      this.touch(existing.id, input.now)
      return { ...existing, lastUsedAt: input.now }
    }
    this.db
      .prepare(
        `INSERT INTO approval_rules
           (id, agent, workspace, workspace_key, tool_name, created_at, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL)`
      )
      .run(input.id, input.agent, input.workspace, input.workspaceKey, input.toolName, input.now)
    return {
      id: input.id,
      agent: input.agent,
      workspace: input.workspace,
      toolName: input.toolName,
      createdAt: input.now,
      lastUsedAt: null
    }
  }

  touch(id: string, at: number): void {
    this.db.prepare('UPDATE approval_rules SET last_used_at = ? WHERE id = ?').run(at, id)
  }

  remove(id: string): boolean {
    const result = this.db.prepare('DELETE FROM approval_rules WHERE id = ?').run(id)
    return Number(result.changes ?? 0) > 0
  }
}
