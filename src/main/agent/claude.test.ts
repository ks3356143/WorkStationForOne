import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveAgentCli, startClaudeRun } from './claude'
import type { AgentRunEvent } from '../../shared/agent-stream'

const STUB = join(process.cwd(), 'scripts/stub-agent.cjs')

function run(
  prompt: string,
  resumeId?: string,
  cli: { bin: string; prefixArgs: string[]; viaNode: boolean } | null = {
    bin: process.execPath,
    prefixArgs: [STUB],
    viaNode: true
  }
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

  it('CLI 报错时给出 error 事件而不是假装成功', async () => {
    const { events } = await run('这次注定失败')
    expect(events.at(-1)).toEqual({ kind: 'error', message: '模拟失败' })
    expect(events.some((event) => event.kind === 'result')).toBe(false)
  })

  it('没有 CLI 时明确报错并立刻结束', async () => {
    const { events, exit } = await run('随便', undefined, null)
    expect(events[0]).toMatchObject({ kind: 'error' })
    expect(String((events[0] as { message: string }).message)).toContain('未找到 Claude CLI')
    expect(exit.code).toBeNull()
  })
})
