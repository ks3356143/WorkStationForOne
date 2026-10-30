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
    transaction: (run) => run(),
    tasks: {
      list: () => tasks,
      find: (id) => tasks.find((task) => task.id === id),
      create: (draft) => ({ id: 't-new', time: '—', done: false, ...draft }) as TaskRecord,
      update: () => {},
      completeTask: () => null
    },
    notes: {
      count: () => 0,
      search: () => [] as NoteSearchHit[],
      create: (text, tag) => ({
        id: 'n-new',
        text,
        time: '刚刚',
        ...(tag ? { tag } : {})
      })
    },
    learning: {
      list: () => cards,
      review: () => {
        throw new Error('not implemented')
      }
    },
    habits: {
      list: () => [] as HabitRecord[],
      setCheckin: () => {}
    },
    audit: { record: vi.fn(), recordStrict: vi.fn() }
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
      'today_overview',
      'tasks_create',
      'tasks_update',
      'tasks_complete',
      'habits_check',
      'learning_review',
      'notes_create'
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

  it('写入按域权限、幂等键与变更广播生效', async () => {
    const source = data()
    const create = vi.fn(source.tasks.create)
    source.tasks.create = create
    const notifyChanged = vi.fn()
    bridge = new McpBridge(source, 'test', {
      mode: (domain) => (domain === 'task' ? 'write' : 'read'),
      notifyChanged
    })
    await bridge.start()
    const endpoint = bridge.issue('s-write')
    if (!endpoint) throw new Error('没有 issue token')

    const call = (id: number, name: string, args: Record<string, unknown>) =>
      rpc(endpoint.url, endpoint.token, {
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name, arguments: args }
      })

    const first = await call(10, 'tasks_create', {
      title: 'MCP 任务',
      idempotency_key: 'k1'
    })
    const firstBody = (await first.json()) as {
      result: { isError?: boolean; content: { text: string }[] }
    }
    expect(firstBody.result.isError).toBeUndefined()
    expect(create).toHaveBeenCalledTimes(1)
    expect(notifyChanged).toHaveBeenCalledWith(['task'])

    const repeat = await call(11, 'tasks_create', {
      title: 'MCP 任务',
      idempotency_key: 'k1'
    })
    const repeatBody = (await repeat.json()) as { result: { content: { text: string }[] } }
    expect(create).toHaveBeenCalledTimes(1)
    expect(repeatBody.result.content[0].text).toBe(firstBody.result.content[0].text)

    const denied = await call(12, 'notes_create', {
      title: '不该写入',
      idempotency_key: 'k2'
    })
    const deniedBody = (await denied.json()) as {
      result: { isError?: boolean; content: { text: string }[] }
    }
    expect(deniedBody.result.isError).toBe(true)
    expect(deniedBody.result.content[0].text).toBe('denied_by_policy')
    expect(source.notes.create).toBeDefined()
    expect(source.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'mcp',
        action: 'deny',
        detail: expect.stringContaining('denied_by_policy')
      })
    )

    const missingKey = await call(13, 'tasks_create', { title: '缺键' })
    const missingBody = (await missingKey.json()) as { result: { isError?: boolean } }
    expect(missingBody.result.isError).toBe(true)
  })

  it('询问模式先等用户决定，拒绝时不执行写入', async () => {
    const source = data()
    const create = vi.fn(source.tasks.create)
    source.tasks.create = create
    const requestPermission = vi.fn(async () => 'deny' as const)
    bridge = new McpBridge(source, 'test', {
      mode: () => 'ask',
      requestPermission,
      isSessionAllowed: () => false
    })
    await bridge.start()
    const endpoint = bridge.issue('s-ask')
    if (!endpoint) throw new Error('没有 issue token')

    const response = await rpc(endpoint.url, endpoint.token, {
      jsonrpc: '2.0',
      id: 20,
      method: 'tools/call',
      params: {
        name: 'tasks_create',
        arguments: { title: '需要审批', idempotency_key: 'ask-1' }
      }
    })
    const body = (await response.json()) as {
      result: { isError?: boolean; content: { text: string }[] }
    }
    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toBe('denied_by_policy')
    expect(create).not.toHaveBeenCalled()
    expect(requestPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 's-ask',
        domain: 'task',
        tool: 'tasks_create'
      })
    )
  })

  it('服务关闭后在同一端口自动重启，旧 token 仍可用', async () => {
    const source = data()
    bridge = new McpBridge(source, 'test', {}, { restartDelayMs: 10 })
    const port = await bridge.start()
    const endpoint = bridge.issue('s-restart')
    if (!endpoint) throw new Error('没有 issue token')

    const raw = bridge as unknown as { server: import('node:http').Server | null }
    raw.server?.close()
    raw.server?.closeAllConnections?.()

    await new Promise((resolve) => setTimeout(resolve, 80))
    const again = bridge.issue('s-restart')
    expect(again?.url).toBe(`http://127.0.0.1:${port}/mcp`)

    const response = await rpc(endpoint.url, endpoint.token, {
      jsonrpc: '2.0',
      id: 30,
      method: 'tools/list'
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { result: { tools: { name: string }[] } }
    expect(body.result.tools).toHaveLength(11)
  })
})
