import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentRunEvent } from '../../shared/agent-stream'
import { buildCodexArgs, parseCodexLine, startCodexRun } from './codex'
import type { AgentCli } from './cli'

const STUB = join(process.cwd(), 'scripts/stub-codex.cjs')
const CLI: AgentCli = { bin: process.execPath, prefixArgs: [STUB], viaNode: true }

function line(value: unknown): string {
  return JSON.stringify(value)
}

function run(prompt: string, resumeId?: string) {
  return new Promise<{
    events: AgentRunEvent[]
    exit: { code: number | null; cancelled: boolean }
  }>((done) => {
    const events: AgentRunEvent[] = []
    startCodexRun({
      prompt,
      ...(resumeId ? { resumeId } : {}),
      cwd: process.cwd(),
      cli: CLI,
      onEvent: (event) => events.push(event),
      onExit: (info) => done({ events, exit: { code: info.code, cancelled: info.cancelled } })
    })
  })
}

describe('buildCodexArgs', () => {
  it('新会话使用只读沙箱与 JSONL，不出现危险开关', () => {
    const args = buildCodexArgs(CLI)

    expect(args.slice(0, 2)).toEqual([CLI.prefixArgs[0], 'exec'])
    expect(args).toEqual(
      expect.arrayContaining([
        '--json',
        '--sandbox',
        'read-only',
        '--skip-git-repo-check',
        '-c',
        'sandbox_mode="read-only"',
        '-c',
        'approval_policy="never"',
        '-'
      ])
    )
    expect(args.join(' ')).not.toContain('--dangerously')
  })

  it('续接会话用 exec resume，并继续在进程级固定只读', () => {
    const args = buildCodexArgs(CLI, 'thread-123')

    expect(args.slice(0, 3)).toEqual([CLI.prefixArgs[0], 'exec', 'resume'])
    expect(args).toEqual(
      expect.arrayContaining([
        '--json',
        '-c',
        'sandbox_mode="read-only"',
        '-c',
        'approval_policy="never"',
        'thread-123',
        '-'
      ])
    )
    expect(args).not.toContain('--sandbox')
  })
})

describe('parseCodexLine', () => {
  it('thread.started 带回 Codex 自己的会话 id', () => {
    expect(parseCodexLine(line({ type: 'thread.started', thread_id: 't-1' }))).toEqual([
      { kind: 'init', sessionId: 't-1' }
    ])
  })

  it('agent_message 只取完成态，避免重复正文', () => {
    const item = { id: 'm1', type: 'agent_message', text: '读完了。' }
    expect(parseCodexLine(line({ type: 'item.updated', item }))).toEqual([])
    expect(parseCodexLine(line({ type: 'item.completed', item }))).toEqual([
      { kind: 'text', text: '读完了。' }
    ])
  })

  it('命令开始时建工具卡，完成时回写状态', () => {
    const started = parseCodexLine(
      line({
        type: 'item.started',
        item: {
          id: 'c1',
          type: 'command_execution',
          command: 'Get-Content src/main/index.ts',
          aggregated_output: '',
          exit_code: null,
          status: 'in_progress'
        }
      })
    )
    expect(started).toContainEqual({
      kind: 'tool',
      id: 'c1',
      name: 'Shell',
      detail: 'Get-Content src/main/index.ts'
    })

    const completed = parseCodexLine(
      line({
        type: 'item.completed',
        item: {
          id: 'c1',
          type: 'command_execution',
          command: 'Get-Content src/main/index.ts',
          aggregated_output: '入口文件',
          exit_code: 0,
          status: 'completed'
        }
      })
    )
    expect(completed).toContainEqual({
      kind: 'tool-result',
      id: 'c1',
      ok: true,
      detail: '入口文件'
    })
  })

  it('失败的命令、文件改动与 MCP 调用都有结果事件', () => {
    expect(
      parseCodexLine(
        line({
          type: 'item.completed',
          item: {
            id: 'c2',
            type: 'command_execution',
            command: 'rm x',
            aggregated_output: 'denied',
            exit_code: 1,
            status: 'failed'
          }
        })
      )
    ).toContainEqual({ kind: 'tool-result', id: 'c2', ok: false, detail: 'denied' })

    expect(
      parseCodexLine(
        line({
          type: 'item.completed',
          item: {
            id: 'f1',
            type: 'file_change',
            changes: [
              { path: 'a.ts', kind: 'update' },
              { path: 'b.ts', kind: 'add' }
            ],
            status: 'completed'
          }
        })
      )
    ).toEqual(
      expect.arrayContaining([
        { kind: 'tool', id: 'f1', name: 'Patch', detail: 'a.ts · b.ts' },
        { kind: 'tool-result', id: 'f1', ok: true, detail: '' }
      ])
    )

    expect(
      parseCodexLine(
        line({
          type: 'item.completed',
          item: {
            id: 'mcp1',
            type: 'mcp_tool_call',
            server: 'filesystem',
            tool: 'read',
            arguments: { path: 'a' },
            result: null,
            error: null,
            status: 'completed'
          }
        })
      )
    ).toContainEqual({ kind: 'tool-result', id: 'mcp1', ok: true, detail: '' })
  })

  it('推理内容不渲染，回合完成与失败映射成结果事件', () => {
    expect(
      parseCodexLine(
        line({ type: 'item.completed', item: { id: 'r1', type: 'reasoning', text: '隐藏思路' } })
      )
    ).toEqual([])
    expect(parseCodexLine(line({ type: 'turn.completed', usage: {} }))).toEqual([
      { kind: 'result', ok: true }
    ])
    expect(parseCodexLine(line({ type: 'turn.failed', error: { message: '网关拒绝' } }))).toEqual([
      { kind: 'error', message: '网关拒绝' }
    ])
    expect(parseCodexLine(line({ type: 'error', message: '流损坏' }))).toEqual([
      { kind: 'error', message: '流损坏' }
    ])
  })

  it('非 JSON 与未知事件不打断整轮', () => {
    expect(parseCodexLine('not json')).toEqual([])
    expect(parseCodexLine(line({ type: 'something.else' }))).toEqual([])
  })
})

describe('startCodexRun · stub 链路', () => {
  it('回放会话 id、命令、正文与完成事件', async () => {
    const { events, exit } = await run('读一下入口')

    expect(exit).toMatchObject({ code: 0, cancelled: false })
    expect(events).toContainEqual({ kind: 'init', sessionId: 'codex-stub-thread' })
    expect(events).toContainEqual(expect.objectContaining({ kind: 'tool', name: 'Shell' }))
    expect(events).toContainEqual(expect.objectContaining({ kind: 'tool-result', ok: true }))
    expect(events).toContainEqual({ kind: 'text', text: 'Codex 只读回复：入口文件已读取。' })
    expect(events).toContainEqual({ kind: 'result', ok: true })
  })

  it('失败时只报一次错，不重复追加', async () => {
    const { events, exit } = await run('这次会失败')

    expect(exit.code).toBe(1)
    const errors = events.filter((event) => event.kind === 'error')
    expect(errors).toEqual([{ kind: 'error', message: '模拟 Codex 失败' }])
  })
})
