import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_HISTORY_MESSAGES,
  MAX_HISTORY_TOOLS,
  parseClaudeHistory,
  parseCodexHistory,
  readSessionHistory
} from './history'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function fixture(lines: unknown[]): string {
  return lines.map((line) => JSON.stringify(line)).join('\n')
}

describe('Claude 历史解析', () => {
  it('只取用户/助手正文，跳过 meta、thinking 与 tool_result', () => {
    const list = parseClaudeHistory(
      's1',
      'r1',
      fixture([
        { type: 'user', isMeta: true, message: { role: 'user', content: '元信息' } },
        {
          type: 'user',
          timestamp: '2026-10-30T10:00:00.000Z',
          message: { role: 'user', content: '先看任务' }
        },
        {
          type: 'assistant',
          timestamp: '2026-10-30T10:01:00.000Z',
          message: {
            role: 'assistant',
            content: [
              { type: 'thinking', thinking: '内部推理' },
              { type: 'text', text: '看完了。' },
              {
                type: 'tool_use',
                id: 'tool-1',
                name: 'Read',
                input: { file_path: 'src/app.ts' }
              }
            ]
          }
        },
        {
          type: 'user',
          timestamp: '2026-10-30T10:02:00.000Z',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: '...' }]
          },
          toolUseResult: {}
        },
        {
          type: 'assistant',
          timestamp: '2026-10-30T10:03:00.000Z',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'tool-2',
                name: 'Write',
                input: { file_path: 'src/new.ts' }
              }
            ]
          }
        },
        {
          type: 'user',
          timestamp: '2026-10-30T10:04:00.000Z',
          message: {
            role: 'user',
            content: [
              { type: 'tool_result', tool_use_id: 'tool-2', is_error: true, content: '失败' }
            ]
          },
          toolUseResult: {}
        }
      ]),
      1_000
    )

    expect(list).toHaveLength(3)
    expect(list[0]).toMatchObject({
      id: 'import-claude-r1-0',
      sessionId: 's1',
      role: 'user',
      text: '先看任务',
      origin: 'import'
    })
    expect(list[1]).toMatchObject({ role: 'assistant', text: '看完了。', origin: 'import' })
    expect(list[1].createdAt).toBe(Date.parse('2026-10-30T10:01:00.000Z'))
    expect(list[1].timeLabel).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(list[1].tools).toEqual([
      expect.objectContaining({ name: 'Read', meta: 'src/app.ts', status: '完成' })
    ])
    expect(list[2]).toMatchObject({ role: 'assistant', text: '', origin: 'import' })
    expect(list[2].tools).toEqual([
      expect.objectContaining({ name: 'Write', meta: 'src/new.ts', status: '失败' })
    ])
  })

  it('剥掉系统提醒，跳过 Codex 环境说明式的用户消息', () => {
    const list = parseClaudeHistory(
      's1',
      'r1',
      fixture([
        {
          type: 'user',
          message: {
            role: 'user',
            content: '<system-reminder>上下文</system-reminder>检查构建'
          }
        },
        {
          type: 'user',
          message: { role: 'user', content: '<environment_context>cwd</environment_context>' }
        }
      ]),
      1_000
    )
    expect(list.map((item) => item.text)).toEqual(['检查构建'])
  })
})

describe('Codex 历史解析', () => {
  it('读取 response_item.message，跳过 developer 与环境说明', () => {
    const list = parseCodexHistory(
      's2',
      'r1',
      fixture([
        { type: 'session_meta', payload: { session_id: 'codex-1' } },
        {
          type: 'response_item',
          timestamp: '2026-10-30T11:00:00.000Z',
          payload: { type: 'message', role: 'developer', content: '系统说明' }
        },
        {
          type: 'response_item',
          timestamp: '2026-10-30T11:01:00.000Z',
          payload: {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: '<environment_context>cwd</environment_context>' }
            ]
          }
        },
        {
          type: 'response_item',
          timestamp: '2026-10-30T11:02:00.000Z',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: '检查构建' }]
          }
        },
        {
          type: 'response_item',
          timestamp: '2026-10-30T11:02:30.000Z',
          payload: {
            type: 'function_call',
            name: 'shell',
            call_id: 'call-1',
            arguments: '{"command":"npm test"}'
          }
        },
        {
          type: 'response_item',
          timestamp: '2026-10-30T11:02:40.000Z',
          payload: { type: 'function_call_output', call_id: 'call-1', output: 'ok' }
        },
        {
          type: 'response_item',
          timestamp: '2026-10-30T11:03:00.000Z',
          payload: {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: '构建通过。' }]
          }
        }
      ]),
      1_000
    )

    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({ id: 'import-codex-r1-0', role: 'user', text: '检查构建' })
    expect(list[1]).toMatchObject({ role: 'assistant', text: '构建通过。', origin: 'import' })
    expect(list[1].tools).toEqual([
      expect.objectContaining({ name: 'shell', meta: 'npm test', status: '完成' })
    ])
  })
})

describe('历史导入边界', () => {
  it('最多保留最近 200 条，并保留原始序号', () => {
    const lines = Array.from({ length: MAX_HISTORY_MESSAGES + 5 }, (_, index) => ({
      type: 'user',
      timestamp: new Date(1_700_000_000_000 + index).toISOString(),
      message: { role: 'user', content: `消息 ${index}` }
    }))
    const list = parseClaudeHistory('s1', 'r1', fixture(lines), 1_000)
    expect(list).toHaveLength(MAX_HISTORY_MESSAGES)
    expect(list[0]).toMatchObject({ text: '消息 5', id: 'import-claude-r1-5' })
    expect(list.at(-1)).toMatchObject({
      text: '消息 204',
      id: `import-claude-r1-${MAX_HISTORY_MESSAGES + 4}`
    })
  })

  it('单条消息的工具卡数量有上限', () => {
    const blocks = Array.from({ length: MAX_HISTORY_TOOLS + 5 }, (_, index) => ({
      type: 'tool_use',
      id: `tool-${index}`,
      name: 'Read',
      input: { file_path: `src/${index}.ts` }
    }))
    const list = parseClaudeHistory(
      's1',
      'r1',
      fixture([{ type: 'assistant', message: { role: 'assistant', content: blocks } }]),
      1_000
    )
    expect(list).toHaveLength(1)
    expect(list[0].tools).toHaveLength(MAX_HISTORY_TOOLS)
  })

  it('从临时 home 读取 Claude / Codex 历史，找不到文件时返回空数组', () => {
    const base = mkdtempSync(join(tmpdir(), 'wsfo-history-'))
    dirs.push(base)
    const claudeDir = join(base, '.claude', 'projects', 'x')
    const codexDir = join(base, '.codex', 'sessions', '2026', '10', '30')
    for (const dir of [claudeDir, codexDir]) {
      mkdirSync(dir, { recursive: true })
    }
    writeFileSync(
      join(claudeDir, 'claude-1.jsonl'),
      fixture([{ type: 'user', message: { role: 'user', content: 'Claude 历史' } }])
    )
    writeFileSync(
      join(codexDir, 'rollout-1.jsonl'),
      fixture([
        { type: 'session_meta', payload: { session_id: 'codex-1' } },
        { type: 'response_item', payload: { type: 'message', role: 'user', content: 'Codex 历史' } }
      ])
    )

    expect(
      readSessionHistory({
        sessionId: 's1',
        agent: 'claude',
        resumeId: 'claude-1',
        home: base
      }).map((item) => item.text)
    ).toEqual(['Claude 历史'])
    expect(
      readSessionHistory({
        sessionId: 's2',
        agent: 'codex',
        resumeId: 'codex-1',
        home: base
      }).map((item) => item.text)
    ).toEqual(['Codex 历史'])
    expect(
      readSessionHistory({
        sessionId: 's3',
        agent: 'claude',
        resumeId: 'missing',
        home: base
      })
    ).toEqual([])
  })
})
