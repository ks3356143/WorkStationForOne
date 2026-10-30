import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AuditLog } from '../db/audit'
import { migrate, openDatabase } from '../db/database'
import { HabitRepository } from '../db/habits'
import { LearningRepository } from '../db/learning'
import { NoteRepository } from '../db/notes'
import { TaskRepository } from '../db/tasks'
import { runInTransaction } from '../db/transaction'
import { McpBridge } from './server'
import type { McpData } from './tools'

const dirs: string[] = []

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'wsfo-mcp-tx-'))
  dirs.push(dir)
  const db = openDatabase(join(dir, 'workstation.db'))
  migrate(db)
  const audit = new AuditLog(db)
  const data: McpData = {
    transaction: (run) => runInTransaction(db, run),
    tasks: new TaskRepository(db, audit),
    notes: new NoteRepository(db, audit),
    learning: new LearningRepository(db, audit),
    habits: new HabitRepository(db, audit),
    audit
  }
  return { db, audit, data }
}

afterEach(() => {
  while (dirs.length) {
    rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

async function call(bridge: McpBridge, name: string, args: Record<string, unknown>, id = 1) {
  const endpoint = bridge.issue('s-tx')
  if (!endpoint) throw new Error('没有 issue token')
  const response = await fetch(endpoint.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${endpoint.token}`
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: args }
    })
  })
  bridge.revoke(endpoint.token)
  return (await response.json()) as {
    result: { isError?: boolean; content: { text: string }[] }
  }
}

describe('MCP 写入事务', () => {
  it('业务写入与 mcp/write 审计同事务提交', async () => {
    const { db, audit, data } = setup()
    const bridge = new McpBridge(data, 'test', { mode: () => 'write' })
    await bridge.start()
    const body = await call(bridge, 'tasks_create', {
      title: '事务内任务',
      idempotency_key: 'tx-ok'
    })
    expect(body.result.isError).toBeUndefined()
    expect(data.tasks.list()).toHaveLength(1)
    expect(audit.recent(10, 'mcp')).toContainEqual(
      expect.objectContaining({ action: 'write', title: 'tasks_create' })
    )
    bridge.close()
    db.close()
  })

  it('审计写入失败时业务写入回滚', async () => {
    const { db, audit, data } = setup()
    const bridge = new McpBridge(data, 'test', { mode: () => 'write' })
    await bridge.start()

    Object.defineProperty(audit, 'recordStrict', {
      value: () => {
        throw new Error('audit down')
      },
      configurable: true
    })
    const body = await call(bridge, 'tasks_create', {
      title: '不该留下',
      idempotency_key: 'tx-fail'
    })
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toContain('事务已回滚')
    expect(data.tasks.list()).toHaveLength(0)
    bridge.close()
    db.close()
  })
})
