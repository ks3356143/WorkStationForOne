import { describe, expect, it } from 'vitest'
import { appendStreamText, parseAgentLine, summarizeToolInput } from './agent-stream'

const line = (value: unknown) => JSON.stringify(value)

describe('parseAgentLine · 基础事件', () => {
  it('解析 init，带模型与会话 id', () => {
    const events = parseAgentLine(
      line({
        type: 'system',
        subtype: 'init',
        model: 'claude-sonnet-4-5',
        session_id: 'abc-123',
        cwd: 'E:/work'
      })
    )
    expect(events).toEqual([{ kind: 'init', model: 'claude-sonnet-4-5', sessionId: 'abc-123' }])
  })

  it('解析助手文本', () => {
    const events = parseAgentLine(
      line({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: '正在读取文件。' }] }
      })
    )
    expect(events).toEqual([{ kind: 'text', text: '正在读取文件。' }])
  })

  it('一条消息里的文本与工具调用按顺序展开', () => {
    const events = parseAgentLine(
      line({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: '我看一下。' },
            { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'src/main/index.ts' } },
            { type: 'tool_use', id: 't2', name: 'Grep', input: { pattern: 'capture' } }
          ]
        }
      })
    )
    expect(events).toEqual([
      { kind: 'text', text: '我看一下。' },
      { kind: 'tool', id: 't1', name: 'Read', detail: 'src/main/index.ts' },
      { kind: 'tool', id: 't2', name: 'Grep', detail: 'capture' }
    ])
  })

  it('解析工具结果，失败时 ok 为 false', () => {
    const events = parseAgentLine(
      line({
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 't1', content: 'file content', is_error: false },
            { type: 'tool_result', tool_use_id: 't2', content: 'boom', is_error: true }
          ]
        }
      })
    )
    expect(events).toEqual([
      { kind: 'tool-result', id: 't1', ok: true, detail: 'file content' },
      { kind: 'tool-result', id: 't2', ok: false, detail: 'boom' }
    ])
  })

  it('解析成功结果，带成本与耗时', () => {
    const events = parseAgentLine(
      line({
        type: 'result',
        subtype: 'success',
        is_error: false,
        total_cost_usd: 0.0123,
        duration_ms: 4321,
        num_turns: 2,
        result: '完成'
      })
    )
    expect(events).toEqual([
      { kind: 'result', ok: true, costUsd: 0.0123, durationMs: 4321, turns: 2 }
    ])
  })

  it('失败结果转成 error 事件', () => {
    const events = parseAgentLine(
      line({
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        result: '上下文超限'
      })
    )
    expect(events).toEqual([{ kind: 'error', message: '上下文超限' }])
  })
})

describe('parseAgentLine · 容错', () => {
  it('空行、非 JSON、非对象都返回空数组', () => {
    expect(parseAgentLine('')).toEqual([])
    expect(parseAgentLine('   ')).toEqual([])
    expect(parseAgentLine('not json')).toEqual([])
    expect(parseAgentLine('[1,2,3]')).toEqual([])
    expect(parseAgentLine('null')).toEqual([])
  })

  it('缺字段的事件被跳过而不是抛错', () => {
    expect(parseAgentLine(line({ type: 'assistant', message: { content: [{}] } }))).toEqual([])
    expect(
      parseAgentLine(
        line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read' }] } })
      )
    ).toEqual([])
    expect(
      parseAgentLine(line({ type: 'user', message: { content: [{ type: 'tool_result' }] } }))
    ).toEqual([])
  })

  it('未知事件类型不产生输出', () => {
    expect(parseAgentLine(line({ type: 'stream_event', event: {} }))).toEqual([])
  })
})

describe('summarizeToolInput', () => {
  it('按工具取关键参数', () => {
    expect(summarizeToolInput('Read', { file_path: 'a/b.ts' })).toBe('a/b.ts')
    expect(summarizeToolInput('Bash', { command: 'npm test' })).toBe('npm test')
    expect(summarizeToolInput('Grep', { pattern: 'TODO' })).toBe('TODO')
    expect(summarizeToolInput('WebFetch', { url: 'https://example.com' })).toBe(
      'https://example.com'
    )
    expect(summarizeToolInput('Task', { description: '调研' })).toBe('调研')
  })

  it('未识别工具退回 JSON，过长截断', () => {
    expect(summarizeToolInput('Custom', { a: 1 })).toBe('{"a":1}')
    const long = summarizeToolInput('Custom', { a: 'x'.repeat(400) })
    expect(long.length).toBe(120)
    expect(long.endsWith('…')).toBe(true)
  })

  it('空输入与非对象输入得到空串', () => {
    expect(summarizeToolInput('Read', {})).toBe('')
    expect(summarizeToolInput('Read', null)).toBe('')
    expect(summarizeToolInput('Read', 'x')).toBe('')
  })
})

describe('appendStreamText', () => {
  it('累积非空增量', () => {
    expect(appendStreamText('', '你好')).toBe('你好')
    expect(appendStreamText('你好', '，世界')).toBe('你好，世界')
    expect(appendStreamText('你好', '')).toBe('你好')
  })
})
