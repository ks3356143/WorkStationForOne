import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentRunEvent } from '../../shared/agent-stream'
import type { CodexMcpRuntime } from '../capabilities/codex-mcp'
import type { ProviderRuntime } from '../providers'
import {
  createCodexAppServerParser,
  startCodexAppServerRun,
  type CodexAppServerExit
} from './codex-app-server'
import type { AgentCli } from './cli'

const STUB = join(process.cwd(), 'scripts/stub-codex.cjs')
const CLI: AgentCli = { bin: process.execPath, prefixArgs: [STUB], viaNode: true }
const provider: ProviderRuntime = {
  baseUrl: 'https://api.example.test/v1',
  model: 'deepseek/deepseek-v4.1-flash',
  token: 'secret-token',
  target: 'codex',
  wireApi: 'responses'
}
const dirs: string[] = []

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wsfo-codex-app-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function run(
  prompt: string,
  options: {
    resumeId?: string
    externalMcp?: CodexMcpRuntime
    autoApprove?: (toolName: string) => 'session' | 'workspace' | null
    onPermission?: (handle: ReturnType<typeof startCodexAppServerRun>) => void
  } = {}
) {
  const events: AgentRunEvent[] = []
  let handle: ReturnType<typeof startCodexAppServerRun>
  const done = new Promise<CodexAppServerExit>((resolve) => {
    handle = startCodexAppServerRun({
      prompt,
      ...(options.resumeId ? { resumeId: options.resumeId } : {}),
      ...(options.externalMcp ? { externalMcp: options.externalMcp } : {}),
      ...(options.autoApprove ? { autoApprove: options.autoApprove } : {}),
      cwd: process.cwd(),
      provider,
      home: home(),
      cli: CLI,
      onEvent: (event) => {
        events.push(event)
        if (event.kind === 'permission') options.onPermission?.(handle)
      },
      onExit: resolve
    })
  })
  return { events, done, handle: () => handle }
}

function externalPolicy(tool: string, approval: 'allow' | 'ask' | 'deny'): CodexMcpRuntime {
  return {
    servers: [],
    env: {},
    secretEnvNames: [],
    policies: { memory: { [tool]: approval } }
  }
}

function streamText(events: AgentRunEvent[]): string {
  return events
    .filter((event): event is Extract<AgentRunEvent, { kind: 'text' }> => event.kind === 'text')
    .map((event) => event.text)
    .join('')
}

describe('Codex app-server 事件解析', () => {
  it('正文按 delta 流式累积，完成事件不重复追加', () => {
    const parser = createCodexAppServerParser()

    expect(
      parser.parse({
        method: 'item/agentMessage/delta',
        params: { threadId: 't1', turnId: 'u1', itemId: 'a1', delta: '先看' }
      })
    ).toEqual([{ kind: 'text', text: '先看' }])
    expect(
      parser.parse({
        method: 'item/agentMessage/delta',
        params: { threadId: 't1', turnId: 'u1', itemId: 'a1', delta: '入口。' }
      })
    ).toEqual([{ kind: 'text', text: '入口。' }])
    expect(
      parser.parse({
        method: 'item/completed',
        params: {
          threadId: 't1',
          turnId: 'u1',
          completedAtMs: 1,
          item: { id: 'a1', type: 'agentMessage', text: '先看入口。' }
        }
      })
    ).toEqual([])
  })

  it('没有 delta 的消息在完成时补正文', () => {
    const parser = createCodexAppServerParser()

    expect(
      parser.parse({
        method: 'item/completed',
        params: {
          threadId: 't1',
          turnId: 'u1',
          completedAtMs: 1,
          item: { id: 'a2', type: 'agentMessage', text: '整段回复' }
        }
      })
    ).toEqual([{ kind: 'text', text: '整段回复' }])
  })

  it('命令、文件改动与 MCP 调用都映射成工具卡', () => {
    const parser = createCodexAppServerParser()

    expect(
      parser.parse({
        method: 'item/started',
        params: {
          threadId: 't1',
          turnId: 'u1',
          startedAtMs: 1,
          item: {
            id: 'c1',
            type: 'commandExecution',
            command: 'Get-Content src/main/index.ts',
            cwd: process.cwd(),
            status: 'inProgress',
            aggregatedOutput: null,
            exitCode: null
          }
        }
      })
    ).toEqual([
      {
        kind: 'tool',
        id: 'c1',
        name: 'Shell',
        detail: 'Get-Content src/main/index.ts'
      }
    ])

    expect(
      parser.parse({
        method: 'item/started',
        params: {
          threadId: 't1',
          turnId: 'u1',
          startedAtMs: 1,
          item: {
            id: 'f1',
            type: 'fileChange',
            status: 'inProgress',
            changes: [
              { path: 'src/a.ts', kind: 'update', diff: '' },
              { path: 'src/b.ts', kind: 'add', diff: '' }
            ]
          }
        }
      })
    ).toEqual([{ kind: 'tool', id: 'f1', name: 'Patch', detail: 'src/a.ts · src/b.ts' }])

    expect(
      parser.parse({
        method: 'item/started',
        params: {
          threadId: 't1',
          turnId: 'u1',
          startedAtMs: 1,
          item: {
            id: 'm1',
            type: 'mcpToolCall',
            server: 'workstationforone',
            tool: 'tasks_list',
            status: 'inProgress',
            arguments: {}
          }
        }
      })
    ).toEqual([
      {
        kind: 'tool',
        id: 'm1',
        name: 'workstationforone/tasks_list',
        detail: '{}'
      }
    ])
  })

  it('工具完成态写回成功与否，并保留可展开的摘要', () => {
    const parser = createCodexAppServerParser()
    parser.parse({
      method: 'item/started',
      params: {
        threadId: 't1',
        turnId: 'u1',
        startedAtMs: 1,
        item: {
          id: 'c1',
          type: 'commandExecution',
          command: 'npm test',
          cwd: process.cwd(),
          status: 'inProgress',
          aggregatedOutput: null,
          exitCode: null
        }
      }
    })

    expect(
      parser.parse({
        method: 'item/completed',
        params: {
          threadId: 't1',
          turnId: 'u1',
          completedAtMs: 2,
          item: {
            id: 'c1',
            type: 'commandExecution',
            command: 'npm test',
            cwd: process.cwd(),
            status: 'completed',
            aggregatedOutput: '全部通过',
            exitCode: 0
          }
        }
      })
    ).toEqual([{ kind: 'tool-result', id: 'c1', ok: true, detail: '全部通过' }])

    expect(
      parser.parse({
        method: 'item/completed',
        params: {
          threadId: 't1',
          turnId: 'u1',
          completedAtMs: 3,
          item: {
            id: 'f1',
            type: 'fileChange',
            status: 'failed',
            changes: [{ path: 'src/a.ts', kind: 'update', diff: '' }]
          }
        }
      })
    ).toEqual([{ kind: 'tool-result', id: 'f1', ok: false, detail: '' }])
  })

  it('回合完成、失败与中断映射成终态事件', () => {
    const parser = createCodexAppServerParser()
    const completed = {
      method: 'turn/completed',
      params: {
        threadId: 't1',
        turn: { id: 'u1', status: 'completed', items: [] }
      }
    }
    expect(parser.parse(completed)).toEqual([{ kind: 'result', ok: true }])

    expect(
      parser.parse({
        method: 'turn/completed',
        params: {
          threadId: 't1',
          turn: {
            id: 'u2',
            status: 'failed',
            items: [],
            error: { message: '网关拒绝', codexErrorInfo: null, additionalDetails: null }
          }
        }
      })
    ).toEqual([{ kind: 'error', message: '网关拒绝' }])

    expect(
      parser.parse({
        method: 'turn/completed',
        params: { threadId: 't1', turn: { id: 'u3', status: 'interrupted', items: [] } }
      })
    ).toEqual([{ kind: 'error', message: '回合已中断' }])
  })

  it('只上报不可重试的错误，忽略推理与未知通知', () => {
    const parser = createCodexAppServerParser()

    expect(
      parser.parse({
        method: 'error',
        params: {
          threadId: 't1',
          turnId: 'u1',
          willRetry: true,
          error: { message: '重试中', codexErrorInfo: null, additionalDetails: null }
        }
      })
    ).toEqual([])
    expect(
      parser.parse({
        method: 'error',
        params: {
          threadId: 't1',
          turnId: 'u1',
          willRetry: false,
          error: { message: '认证失败', codexErrorInfo: null, additionalDetails: null }
        }
      })
    ).toEqual([{ kind: 'error', message: '认证失败' }])
    expect(
      parser.parse({
        method: 'item/completed',
        params: {
          threadId: 't1',
          turnId: 'u1',
          completedAtMs: 1,
          item: { id: 'r1', type: 'reasoning', summary: ['内部'], content: ['思路'] }
        }
      })
    ).toEqual([])
    expect(parser.parse({ method: 'something/else', params: {} })).toEqual([])
    expect(parser.parse('not-json')).toEqual([])
  })

  it('保存文件改动条目，供审批卡显示目标路径', () => {
    const parser = createCodexAppServerParser()
    parser.parse({
      method: 'item/started',
      params: {
        threadId: 't1',
        turnId: 'u1',
        startedAtMs: 1,
        item: {
          id: 'f9',
          type: 'fileChange',
          status: 'inProgress',
          changes: [{ path: 'src/target.ts', kind: 'update', diff: '' }]
        }
      }
    })

    expect(parser.item('f9')).toMatchObject({
      id: 'f9',
      type: 'fileChange',
      changes: [{ path: 'src/target.ts' }]
    })
  })
})

describe('startCodexAppServerRun · stub 链路', () => {
  it('完成初始化、续接/建线程、流式正文与结果', async () => {
    const { events, done } = run('读一下入口')
    const exit = await done

    expect(exit).toMatchObject({ code: 0, cancelled: false })
    expect(events).toContainEqual({
      kind: 'init',
      sessionId: 'codex-stub-thread',
      model: 'stub-model'
    })
    expect(events).toContainEqual({
      kind: 'tool',
      id: 'cmd_1',
      name: 'Shell',
      detail: 'Get-Content src/main/index.ts'
    })
    expect(events).toContainEqual({
      kind: 'tool-result',
      id: 'cmd_1',
      ok: true,
      detail: '入口文件已读取'
    })
    expect(streamText(events)).toBe('Codex 工作区回复：入口文件已读取。')
    expect(events).toContainEqual({ kind: 'result', ok: true })
    expect(events.filter((event) => event.kind === 'init')).toHaveLength(1)
  })

  it('允许一次后把 accept 回传给 app-server 并继续本轮', async () => {
    let permissionRequestId = ''
    const { events, done, handle } = run('写一个文件', {
      onPermission: (active) => {
        const request = events.find((event) => event.kind === 'permission')
        if (request?.kind !== 'permission') return
        permissionRequestId = request.request.requestId
        expect(request.request).toMatchObject({
          toolName: 'Shell',
          detail: 'Set-Content note.txt "hello"',
          toolUseId: 'cmd_write'
        })
        expect(handle().respondPermission(request.request.requestId, 'allow')).toBe(true)
        expect(active.respondPermission('missing-request', 'allow')).toBe(false)
      }
    })
    const exit = await done

    expect(exit).toMatchObject({ code: 0, cancelled: false })
    expect(permissionRequestId).not.toBe('')
    expect(events).toContainEqual({
      kind: 'tool-result',
      id: 'cmd_write',
      ok: true,
      detail: '已写入 note.txt'
    })
    expect(streamText(events)).toBe('已允许写入。')
    expect(events).toContainEqual({ kind: 'result', ok: true })
  })

  it('拒绝后把 decline 回传，工具卡标记失败但回合继续', async () => {
    const { events, done } = run('写一个文件', {
      onPermission: (active) => {
        const request = events.find((event) => event.kind === 'permission')
        if (request?.kind === 'permission') {
          expect(active.respondPermission(request.request.requestId, 'deny', '用户拒绝')).toBe(true)
        }
      }
    })
    const exit = await done

    expect(exit).toMatchObject({ code: 0, cancelled: false })
    expect(events).toContainEqual({
      kind: 'tool-result',
      id: 'cmd_write',
      ok: false,
      detail: '用户拒绝执行'
    })
    expect(streamText(events)).toBe('已拒绝写入。')
    expect(events).toContainEqual({ kind: 'result', ok: true })
  })

  it('文件改动审批把目标路径带进卡片，允许后继续', async () => {
    const { events, done } = run('改文件 note.txt', {
      onPermission: (active) => {
        const request = events.find((event) => event.kind === 'permission')
        if (request?.kind !== 'permission') return
        expect(request.request).toMatchObject({
          toolName: 'Patch',
          detail: 'note.txt',
          toolUseId: 'file_write',
          description: 'Codex 想新增 note.txt'
        })
        expect(active.respondPermission(request.request.requestId, 'allow')).toBe(true)
      }
    })
    const exit = await done

    expect(exit).toMatchObject({ code: 0, cancelled: false })
    expect(events).toContainEqual({
      kind: 'tool-result',
      id: 'file_write',
      ok: true,
      detail: ''
    })
    expect(streamText(events)).toBe('已允许写入。')
    expect(events).toContainEqual({ kind: 'result', ok: true })
  })

  it('额外权限请求允许时只授予本次回合', async () => {
    const { events, done } = run('额外权限', {
      onPermission: (active) => {
        const request = events.find((event) => event.kind === 'permission')
        if (request?.kind !== 'permission') return
        expect(request.request).toMatchObject({
          toolName: 'Permissions',
          detail: '需要访问网络',
          toolUseId: 'perm_1'
        })
        expect(active.respondPermission(request.request.requestId, 'allow')).toBe(true)
      }
    })
    const exit = await done

    expect(exit).toMatchObject({ code: 0, cancelled: false })
    expect(streamText(events)).toBe('已授予额外权限。')
    expect(events).toContainEqual({ kind: 'result', ok: true })
  })

  it('MCP 只读工具 elicitation 自动允许，不弹审批卡', async () => {
    const { events, done } = run('用 MCP 工具')

    const exit = await done

    expect(exit).toMatchObject({ code: 0, cancelled: false })
    expect(events.some((event) => event.kind === 'permission')).toBe(false)
    expect(streamText(events)).toBe('已允许 MCP 调用。')
    expect(events).toContainEqual({ kind: 'result', ok: true })
  })

  it('MCP 写工具 elicitation 进入审批卡，允许后回 accept', async () => {
    const { events, done } = run('MCP 写', {
      onPermission: (active) => {
        const request = events.find((event) => event.kind === 'permission')
        if (request?.kind !== 'permission') return
        expect(request.request.toolName).toContain('MCP · workstationforone/tasks_create')
        expect(request.request.description).toContain('workstationforone')
        expect(request.request.inputPreview).toContain('toolParams')
        expect(active.respondPermission(request.request.requestId, 'allow')).toBe(true)
      }
    })
    const exit = await done

    expect(exit).toMatchObject({ code: 0, cancelled: false })
    expect(streamText(events)).toBe('已允许 MCP 调用。')
    expect(events).toContainEqual({ kind: 'result', ok: true })
  })

  it('拒绝 MCP 写工具 elicitation 时回 decline', async () => {
    const { events, done } = run('MCP 写', {
      onPermission: (active) => {
        const request = events.find((event) => event.kind === 'permission')
        if (request?.kind === 'permission') {
          expect(active.respondPermission(request.request.requestId, 'deny')).toBe(true)
        }
      }
    })
    const exit = await done

    expect(exit).toMatchObject({ code: 0, cancelled: false })
    expect(streamText(events)).toBe('已拒绝 MCP 调用。')
    expect(events).toContainEqual({ kind: 'result', ok: true })
  })

  it('外部 MCP allow 工具自动接受，不弹审批卡', async () => {
    const { events, done } = run('外部 MCP 允许', {
      externalMcp: externalPolicy('search', 'allow')
    })
    const exit = await done

    expect(exit).toMatchObject({ code: 0, cancelled: false })
    expect(events.some((event) => event.kind === 'permission')).toBe(false)
    expect(streamText(events)).toBe('已允许外部 MCP。')
    expect(events).toContainEqual({ kind: 'result', ok: true })
  })

  it('外部 MCP ask 工具进入审批卡，允许后回 accept', async () => {
    const { events, done } = run('外部 MCP 询问', {
      externalMcp: externalPolicy('write', 'ask'),
      onPermission: (active) => {
        const request = events.find((event) => event.kind === 'permission')
        if (request?.kind !== 'permission') return
        expect(request.request.toolName).toBe('MCP · memory/write')
        expect(request.request.description).toContain('memory')
        expect(request.request.inputPreview).toContain('toolParams')
        expect(active.respondPermission(request.request.requestId, 'allow')).toBe(true)
      }
    })
    const exit = await done

    expect(exit).toMatchObject({ code: 0, cancelled: false })
    expect(streamText(events)).toBe('已允许外部 MCP。')
    expect(events).toContainEqual({ kind: 'result', ok: true })
  })

  it('外部 MCP deny 工具直接拒绝，不弹审批卡', async () => {
    const { events, done } = run('外部 MCP 禁止', {
      externalMcp: externalPolicy('blocked', 'deny')
    })
    const exit = await done

    expect(exit).toMatchObject({ code: 0, cancelled: false })
    expect(events.some((event) => event.kind === 'permission')).toBe(false)
    expect(streamText(events)).toBe('已拒绝外部 MCP。')
    expect(events).toContainEqual({ kind: 'result', ok: true })
  })

  it('MCP 规则命中时不弹卡并回 accept', async () => {
    const { events, done } = run('MCP 写', { autoApprove: () => 'workspace' })
    const exit = await done

    expect(exit).toMatchObject({ code: 0, cancelled: false })
    expect(events.some((event) => event.kind === 'permission')).toBe(false)
    expect(streamText(events)).toBe('已允许 MCP 调用。')
    expect(events).toContainEqual({ kind: 'result', ok: true })
  })

  it('Shell 会话规则命中时不弹卡', async () => {
    const asked: string[] = []
    const { events, done } = run('写一个文件', {
      autoApprove: (toolName) => {
        asked.push(toolName)
        return toolName === 'Shell' ? 'session' : null
      }
    })
    const exit = await done

    expect(asked).toEqual(['Shell'])
    expect(exit).toMatchObject({ code: 0, cancelled: false })
    expect(events.some((event) => event.kind === 'permission')).toBe(false)
    expect(streamText(events)).toBe('已允许写入。')
  })

  it('Permissions 未命中规则时仍发卡', async () => {
    const { events, done } = run('额外权限', {
      autoApprove: () => null,
      onPermission: (active) => {
        const request = events.find((event) => event.kind === 'permission')
        if (request?.kind !== 'permission') return
        expect(request.request.toolName).toBe('Permissions')
        expect(active.respondPermission(request.request.requestId, 'allow')).toBe(true)
      }
    })
    const exit = await done

    expect(exit).toMatchObject({ code: 0, cancelled: false })
    expect(streamText(events)).toBe('已授予额外权限。')
  })

  it('自动批准不覆盖外部 MCP 的 deny 策略', async () => {
    const { events, done } = run('外部 MCP 禁止', {
      externalMcp: externalPolicy('blocked', 'deny'),
      autoApprove: () => 'workspace'
    })
    const exit = await done

    expect(exit).toMatchObject({ code: 0, cancelled: false })
    expect(events.some((event) => event.kind === 'permission')).toBe(false)
    expect(streamText(events)).toBe('已拒绝外部 MCP。')
  })

  it('续接已有 thread 时使用 thread/resume', async () => {
    const { events, done } = run('继续上次', { resumeId: 'codex-stub-thread' })
    const exit = await done

    expect(exit).toMatchObject({ code: 0, cancelled: false })
    expect(events).toContainEqual({
      kind: 'init',
      sessionId: 'codex-stub-resumed',
      model: 'stub-model'
    })
    expect(streamText(events)).toBe('已续接 Codex 线程。')
    expect(events).toContainEqual({ kind: 'result', ok: true })
  })

  it('找不到可续接的 thread 时明确报错并结束', async () => {
    const { events, done } = run('继续上次', { resumeId: 'missing-thread' })
    const exit = await done

    expect(exit).toMatchObject({ code: 0, cancelled: false })
    expect(events).toContainEqual(expect.objectContaining({ kind: 'error' }))
    const error = events.find((event) => event.kind === 'error')
    expect(error?.kind === 'error' ? error.message : '').toContain('无法续接')
    expect(events.some((event) => event.kind === 'result')).toBe(false)
  })
})
