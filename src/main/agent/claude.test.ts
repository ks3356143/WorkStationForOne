import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { McpBridge } from '../mcp/server'
import {
  buildClaudeArgs,
  providerEnv,
  resolveAgentCli,
  startClaudeRun,
  type RunHandle
} from './claude'
import type { AgentRunEvent } from '../../shared/agent-stream'

const STUB = join(process.cwd(), 'scripts/stub-agent.cjs')

function run(
  prompt: string,
  resumeId?: string,
  cli: { bin: string; prefixArgs: string[]; viaNode: boolean } | null = {
    bin: process.execPath,
    prefixArgs: [STUB],
    viaNode: true
  },
  autoApprove?: (toolName: string) => 'session' | 'workspace' | null
) {
  return new Promise<{
    events: AgentRunEvent[]
    exit: { code: number | null; cancelled: boolean }
  }>((done) => {
    const events: AgentRunEvent[] = []
    startClaudeRun({
      prompt,
      resumeId,
      cwd: process.cwd(),
      cli,
      ...(autoApprove ? { autoApprove } : {}),
      onEvent: (event) => events.push(event),
      onExit: (info) => done({ events, exit: { code: info.code, cancelled: info.cancelled } })
    })
  })
}

describe('resolveAgentCli', () => {
  it('WS_AGENT_CLI 指向脚本时用 node 执行', () => {
    const cli = resolveAgentCli({ WS_AGENT_CLI: STUB, PATH: '' })
    expect(cli).toMatchObject({ viaNode: true, prefixArgs: [STUB] })
  })

  it('WS_AGENT_CLI 指向可执行文件时直接执行', () => {
    const cli = resolveAgentCli({ WS_AGENT_CLI: '/usr/bin/claude', PATH: '' })
    expect(cli).toMatchObject({ viaNode: false, bin: '/usr/bin/claude', prefixArgs: [] })
  })

  it('找不到 claude 时返回 null，而不是伪造一个', () => {
    expect(resolveAgentCli({ PATH: '' })).toBeNull()
  })
})

describe('Provider 隔离', () => {
  const cli = { bin: 'claude', prefixArgs: [], viaNode: false }
  const provider = {
    baseUrl: 'http://127.0.0.1:23333',
    model: 'deepseek-v4-flash',
    token: 'sk-secret',
    target: 'claude' as const,
    wireApi: 'responses' as const
  }

  it('自定义 provider 的 env 同时覆盖主模型与三档默认模型', () => {
    expect(providerEnv(provider)).toMatchObject({
      ANTHROPIC_BASE_URL: provider.baseUrl,
      ANTHROPIC_AUTH_TOKEN: provider.token,
      ANTHROPIC_MODEL: provider.model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: provider.model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: provider.model,
      ANTHROPIC_DEFAULT_OPUS_MODEL: provider.model
    })
  })

  it('自定义 provider 忽略用户级 settings 并固定模型，token 不进参数', () => {
    const args = buildClaudeArgs(cli, undefined, provider)
    expect(args).toEqual(
      expect.arrayContaining(['--setting-sources', 'project', '--model', provider.model])
    )
    expect(args.join(' ')).not.toContain(provider.token)
    expect(args.join(' ')).not.toContain('--dangerously')
  })

  it('继承模式不加模型参数，但仍隔离用户 settings 与全局 MCP', () => {
    const args = buildClaudeArgs(cli, undefined)
    expect(args).toEqual(expect.arrayContaining(['--setting-sources', 'project']))
    expect(args).toContain('--strict-mcp-config')
    expect(args).not.toContain('--model')
    expect(providerEnv(undefined)).toBeUndefined()
  })

  it('外部 MCP 工具只把显式 allow / deny 放进参数', () => {
    const args = buildClaudeArgs(cli, undefined, undefined, undefined, undefined, {
      allowedTools: ['mcp__memory__read'],
      disallowedTools: ['mcp__memory__write']
    })
    const allowedIndex = args.indexOf('--allowedTools')
    const disallowedIndex = args.indexOf('--disallowedTools')
    expect(args.slice(allowedIndex + 1)).toContain('mcp__memory__read')
    expect(args.slice(disallowedIndex + 1)).toContain('mcp__memory__write')
    expect(args.join(' ')).not.toContain('--dangerously')
  })

  it('插件目录只以 --plugin-dir 进入命令行', () => {
    const args = buildClaudeArgs(cli, undefined, undefined, undefined, undefined, {
      plugins: ['C:\\Data\\plugins\\demo', 'C:\\Data\\plugins\\other']
    })
    expect(args.filter((arg) => arg === '--plugin-dir')).toHaveLength(2)
    expect(args).toEqual(
      expect.arrayContaining([
        '--plugin-dir',
        'C:\\Data\\plugins\\demo',
        '--plugin-dir',
        'C:\\Data\\plugins\\other'
      ])
    )
  })

  it('MCP 配置只以临时文件路径进入参数，本地 MCP 读写工具都在允许列表里', () => {
    const path = 'C:\\Temp\\ws-mcp-test\\mcp.json'
    const args = buildClaudeArgs(cli, undefined, undefined, undefined, path)
    expect(args).toEqual(expect.arrayContaining(['--mcp-config', path]))
    expect(args).toEqual(
      expect.arrayContaining([
        'mcp__workstationforone__tasks_list',
        'mcp__workstationforone__notes_search',
        'mcp__workstationforone__learning_due',
        'mcp__workstationforone__habits_summary',
        'mcp__workstationforone__today_overview',
        'mcp__workstationforone__tasks_create',
        'mcp__workstationforone__tasks_update',
        'mcp__workstationforone__tasks_complete',
        'mcp__workstationforone__habits_check',
        'mcp__workstationforone__learning_review',
        'mcp__workstationforone__notes_create'
      ])
    )
    expect(args.join(' ')).not.toMatch(/Bearer|token/i)
    expect(args.join(' ')).not.toContain('--dangerously')
  })
})

describe('startClaudeRun · stub 链路', () => {
  it('按顺序回放文本、工具、工具结果与完成事件', async () => {
    const { events, exit } = await run('读一下看板')
    expect(events.map((event) => event.kind)).toEqual([
      'init',
      'text',
      'tool',
      'tool-result',
      'text',
      'result'
    ])
    expect(events[1]).toEqual({ kind: 'text', text: '先把当前看板读一遍。' })
    expect(events[2]).toMatchObject({ kind: 'tool', name: 'Read', detail: 'src/main/index.ts' })
    expect(events[3]).toMatchObject({ kind: 'tool-result', id: 'stub-tool-1', ok: true })
    expect(events[5]).toMatchObject({ kind: 'result', ok: true, costUsd: 0.001 })
    expect(exit.code).toBe(0)
    expect(exit.cancelled).toBe(false)
  })

  it('MCP 配置通过临时文件交给 CLI，并真的调通只读桥', async () => {
    const bridge = new McpBridge(
      {
        transaction: (run) => run(),
        tasks: {
          list: () => [],
          find: () => undefined,
          create: () => {
            throw new Error('not implemented')
          },
          update: () => {},
          completeTask: () => null
        },
        notes: {
          count: () => 0,
          search: () => [],
          create: () => {
            throw new Error('not implemented')
          }
        },
        learning: {
          list: () => [],
          review: () => {
            throw new Error('not implemented')
          }
        },
        habits: { list: () => [], setCheckin: () => {} },
        audit: { record: () => {}, recordStrict: () => {} }
      },
      'test'
    )
    await bridge.start()
    const endpoint = bridge.issue('s-mcp')
    if (!endpoint) throw new Error('MCP 端点创建失败')

    const events: AgentRunEvent[] = []
    const exit = await new Promise<{ code: number | null }>((done) => {
      startClaudeRun({
        prompt: 'MCP 概览',
        cwd: process.cwd(),
        cli: { bin: process.execPath, prefixArgs: [STUB], viaNode: true },
        mcp: endpoint,
        onEvent: (event) => events.push(event),
        onExit: (info) => done({ code: info.code })
      })
    })
    bridge.revoke(endpoint.token)
    bridge.close()

    expect(exit.code).toBe(0)
    expect(events).toContainEqual({ kind: 'text', text: 'MCP 概览：读取成功。' })
    expect(
      events.some((event) => event.kind === 'tool' && event.name.includes('today_overview'))
    ).toBe(true)
  })

  it('CLI 报错时给出 error 事件而不是假装成功', async () => {
    const { events } = await run('这次注定失败')
    expect(events.at(-1)).toEqual({ kind: 'error', message: '模拟失败' })
    expect(events.some((event) => event.kind === 'result')).toBe(false)
  })

  it('转发 can_use_tool 请求，允许后继续本轮', async () => {
    const events: AgentRunEvent[] = []
    let handle: RunHandle | undefined
    const exit = await new Promise<{ code: number | null }>((done) => {
      handle = startClaudeRun({
        prompt: '需要审批',
        cwd: process.cwd(),
        cli: { bin: process.execPath, prefixArgs: [STUB], viaNode: true },
        onEvent: (event) => {
          events.push(event)
          if (event.kind === 'permission') {
            expect(handle?.respondPermission(event.request.requestId, 'allow')).toBe(true)
          }
        },
        onExit: (info) => done({ code: info.code })
      })
    })

    const permission = events.find((event) => event.kind === 'permission')
    expect(permission).toMatchObject({
      kind: 'permission',
      request: { toolName: 'Write', detail: 'tmp/stub.txt' }
    })
    expect(events.at(-1)).toMatchObject({
      kind: 'result',
      ok: true
    })
    expect(events.some((event) => event.kind === 'text' && event.text.includes('已写入'))).toBe(
      true
    )
    expect(exit.code).toBe(0)
  })

  it('规则命中时不发 permission 事件，直接回写 allow', async () => {
    const asked: string[] = []
    const { events, exit } = await run('需要审批', undefined, undefined, (toolName) => {
      asked.push(toolName)
      return 'workspace'
    })

    expect(asked).toEqual(['Write'])
    expect(events.some((event) => event.kind === 'permission')).toBe(false)
    expect(
      events.some((event) => event.kind === 'text' && event.text.includes('已写入临时文件'))
    ).toBe(true)
    expect(exit.code).toBe(0)
  })

  it('自动批准不作用于 AskUserQuestion', async () => {
    const { events } = await run('需要问答', undefined, undefined, () => 'workspace')
    expect(events.some((event) => event.kind === 'permission')).toBe(false)
    expect(events.some((event) => event.kind === 'text' && event.text.includes('问答被拒绝'))).toBe(
      true
    )
  })

  it('拒绝后 CLI 收到 deny，不会继续写入', async () => {
    const events: AgentRunEvent[] = []
    let handle: RunHandle | undefined
    await new Promise<void>((done) => {
      handle = startClaudeRun({
        prompt: '需要审批',
        cwd: process.cwd(),
        cli: { bin: process.execPath, prefixArgs: [STUB], viaNode: true },
        onEvent: (event) => {
          events.push(event)
          if (event.kind === 'permission') {
            expect(handle?.respondPermission(event.request.requestId, 'deny', '用户拒绝')).toBe(
              true
            )
          }
        },
        onExit: () => done()
      })
    })

    expect(events.some((event) => event.kind === 'text' && event.text.includes('权限被拒绝'))).toBe(
      true
    )
    expect(events.some((event) => event.kind === 'text' && event.text.includes('已写入'))).toBe(
      false
    )
  })

  it('宿主内问答自动拒绝，不把问题当普通工具审批', async () => {
    const { events } = await run('需要问答')
    expect(events.some((event) => event.kind === 'permission')).toBe(false)
    expect(events.some((event) => event.kind === 'text' && event.text.includes('问答被拒绝'))).toBe(
      true
    )
  })

  it('没有 CLI 时明确报错并立刻结束', async () => {
    const { events, exit } = await run('随便', undefined, null)
    expect(events[0]).toMatchObject({ kind: 'error' })
    expect(String((events[0] as { message: string }).message)).toContain('未找到 Claude CLI')
    expect(exit.code).toBeNull()
  })
})
