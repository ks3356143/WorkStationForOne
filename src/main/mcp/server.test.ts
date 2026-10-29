import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HabitRecord, LearningItemRecord, NoteSearchHit, TaskRecord } from '../../shared/ipc'
import { McpBridge } from './server'
import type { McpData } from './tools'

const tasks: TaskRecord[] = [
  { id: 't1', title: '今天到期', time: '—', done: false, dueDate: '2026-10-29' }
]
const cards: LearningItemRecord[] = []

function data(): McpData {
  return {
    tasks: { list: () => tasks },
    notes: { count: () => 0, search: () => [] as NoteSearchHit[] },
    learning: { list: () => cards },
    habits: { list: () => [] as HabitRecord[] },
    audit: { record: vi.fn() }
  }
}

let bridge: McpBridge | null = null

afterEach(() => {
  bridge?.close()
  bridge = null
})

async function start() {
  const source = data()
  bridge = new McpBridge(source, '0.0.0-test')
  const port = await bridge.start()
  const endpoint = bridge.issue('s-1')
  if (!endpoint) throw new Error('没有 issue token')
  return { source, port, endpoint }
}

function rpc(url: string, token: string, body: unknown) {
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  })
}

describe('MCP HTTP 桥', () => {
  it('只接受带 Bearer Token 的本地请求', async () => {
    const { endpoint } = await start()
    const noAuth = await fetch(endpoint.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })
    })
    expect(noAuth.status).toBe(401)

    const wrong = await rpc(endpoint.url, 'wrong-token', { jsonrpc: '2.0', id: 1, method: 'ping' })
    expect(wrong.status).toBe(401)
  })

  it('initialize、tools/list 与 tools/call 走 JSON-RPC', async () => {
    const { endpoint, source } = await start()

    const init = await rpc(endpoint.url, endpoint.token, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', clientInfo: { name: 'test' } }
    })
    const initBody = (await init.json()) as {
      result: {
        protocolVersion: string
        capabilities: { tools: unknown }
        serverInfo: { name: string }
      }
    }
    expect(initBody.result.protocolVersion).toBe('2025-06-18')
    expect(initBody.result.capabilities.tools).toBeTruthy()
    expect(initBody.result.serverInfo.name).toBe('workstation-for-one')

    const list = await rpc(endpoint.url, endpoint.token, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list'
    })
    const listBody = (await list.json()) as { result: { tools: { name: string }[] } }
    expect(listBody.result.tools.map((tool) => tool.name)).toEqual([
      'tasks_list',
      'notes_search',
      'learning_due',
      'habits_summary',
      'today_overview'
    ])

    const call = await rpc(endpoint.url, endpoint.token, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'tasks_list', arguments: { scope: 'today' } }
    })
    const callBody = (await call.json()) as {
      result: { isError?: boolean; content: { text: string }[] }
    }
    expect(callBody.result.isError).toBeUndefined()
    const text = callBody.result.content[0].text as string
    expect(text).toContain('今天到期')
    expect(source.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'mcp', targetId: 's-1', title: 'tasks_list' })
    )
  })

  it('通知返回 202，工具参数错误返回 isError', async () => {
    const { endpoint } = await start()

    const notification = await rpc(endpoint.url, endpoint.token, {
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    })
    expect(notification.status).toBe(202)

    const bad = await rpc(endpoint.url, endpoint.token, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'tasks_list', arguments: { scope: 'nope' } }
    })
    const body = (await bad.json()) as { result: { isError: boolean } }
    expect(body.result.isError).toBe(true)
  })

  it('未知方法返回 JSON-RPC 错误，撤销 token 后失效', async () => {
    const { endpoint } = await start()
    const unknown = await rpc(endpoint.url, endpoint.token, {
      jsonrpc: '2.0',
      id: 5,
      method: 'resources/list'
    })
    const body = (await unknown.json()) as { error: { code: number } }
    expect(body.error.code).toBe(-32601)

    bridge?.revoke(endpoint.token)
    const revoked = await rpc(endpoint.url, endpoint.token, {
      jsonrpc: '2.0',
      id: 6,
      method: 'ping'
    })
    expect(revoked.status).toBe(401)
  })
})
