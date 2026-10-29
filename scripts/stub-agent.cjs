#!/usr/bin/env node
/**
 * 冒烟用的假 CLI：行为对齐 `claude -p --input-format stream-json
 * --output-format stream-json --verbose --permission-prompts host`。
 * 分块回放并留出真实节奏的间隔；支持发 can_use_tool 控制请求并等待宿主响应。
 * 用法：WS_AGENT_CLI=<此文件路径>，应用会用它替代真实 claude。
 */
const pendingPermissions = new Map()
const { readFileSync } = require('node:fs')
let buffer = ''
let started = false

const emit = (payload) => process.stdout.write(`${JSON.stringify(payload)}\n`)
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function promptFromMessage(message) {
  const content = message?.message?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
}

async function runFlow(prompt) {
  if (prompt.includes('MCP')) {
    emit({ type: 'system', subtype: 'init', model: 'stub-model', session_id: 'stub-mcp' })
    await wait(80)
    const index = process.argv.indexOf('--mcp-config')
    const path = index >= 0 ? process.argv[index + 1] : ''
    let server = null
    try {
      const config = JSON.parse(readFileSync(path, 'utf8'))
      server = config?.mcpServers?.workstationforone ?? null
    } catch {
      server = null
    }
    const token =
      typeof server?.headers?.Authorization === 'string'
        ? server.headers.Authorization.replace(/^Bearer\s+/i, '')
        : ''
    if (!server?.url || !token) {
      emit({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'MCP 配置缺失。' }] }
      })
      emit({ type: 'result', subtype: 'success', is_error: false, num_turns: 1 })
      return
    }
    const leaked = process.argv.join(' ').includes(token)
    const approval = prompt.includes('审批')
    const writeMode = prompt.includes('写任务') || approval
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate()
    ).padStart(2, '0')}`
    const toolName = writeMode ? 'tasks_create' : 'today_overview'
    const toolArgs = writeMode
      ? {
          title: approval ? 'MCP 审批写入' : 'MCP 写入测试',
          dueDate: today,
          list: 'Agent',
          idempotency_key: `smoke-${Date.now()}`
        }
      : {}
    let overview = ''
    let error = ''
    try {
      const response = await fetch(server.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: toolName, arguments: toolArgs }
        })
      })
      const data = await response.json()
      overview = data?.result?.content?.[0]?.text ?? ''
      if (!overview) error = `HTTP ${response.status}`
      if (data?.result?.isError) error = overview
    } catch (issue) {
      error = issue instanceof Error ? issue.message : '请求失败'
    }
    emit({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'stub-mcp-tool',
            name: `mcp__workstationforone__${toolName}`,
            input: toolArgs
          }
        ]
      }
    })
    await wait(40)
    emit({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'stub-mcp-tool',
            content: overview || error,
            is_error: Boolean(error)
          }
        ]
      }
    })
    await wait(60)
    emit({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text:
              overview && !error && !leaked
                ? writeMode
                  ? approval
                    ? 'MCP 审批写入：已创建。'
                    : 'MCP 写任务：已创建。'
                  : 'MCP 概览：读取成功。'
                : `MCP ${writeMode ? '写任务' : '概览'}：${leaked ? 'token 泄漏' : error || '返回为空'}。`
          }
        ]
      }
    })
    emit({ type: 'result', subtype: 'success', is_error: false, num_turns: 1 })
    return
  }

  if (prompt.includes('失败')) {
    emit({ type: 'system', subtype: 'init', model: 'stub-model', session_id: 'stub-fail' })
    await wait(120)
    emit({ type: 'result', subtype: 'error_during_execution', is_error: true, result: '模拟失败' })
    return
  }

  if (prompt.includes('需要问答')) {
    emit({ type: 'system', subtype: 'init', model: 'stub-model', session_id: 'stub-question' })
    await wait(80)
    emit({
      type: 'control_request',
      request_id: 'question-1',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'AskUserQuestion',
        input: { questions: [{ question: '选哪个？' }] },
        tool_use_id: 'stub-question-tool',
        description: '向用户提问'
      }
    })
    const decision = await new Promise((resolve) => pendingPermissions.set('question-1', resolve))
    emit({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: decision?.behavior === 'deny' ? '问答被拒绝，未继续。' : '不应允许宿主问答。'
          }
        ]
      }
    })
    await wait(60)
    emit({
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0.001,
      duration_ms: 8,
      num_turns: 1
    })
    return
  }

  if (prompt.includes('需要审批')) {
    emit({ type: 'system', subtype: 'init', model: 'stub-model', session_id: 'stub-permission' })
    await wait(120)
    emit({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: '需要写入临时文件。' }] }
    })
    emit({
      type: 'control_request',
      request_id: 'perm-1',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Write',
        display_name: 'Write',
        input: { file_path: 'tmp/stub.txt', content: 'ok' },
        tool_use_id: 'stub-perm-tool',
        description: '写入临时文件'
      }
    })
    const decision = await new Promise((resolve) => pendingPermissions.set('perm-1', resolve))
    if (decision?.behavior === 'allow') {
      emit({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: '已写入临时文件。' },
            {
              type: 'tool_use',
              id: 'stub-perm-tool',
              name: 'Write',
              input: { file_path: 'tmp/stub.txt' }
            }
          ]
        }
      })
      emit({
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'stub-perm-tool', content: 'ok', is_error: false }
          ]
        }
      })
    } else {
      emit({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: '权限被拒绝，未写入。' }] }
      })
    }
    await wait(80)
    emit({
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0.001,
      duration_ms: 12,
      num_turns: 1
    })
    return
  }

  emit({ type: 'system', subtype: 'init', model: 'stub-model', session_id: 'stub-session' })
  await wait(160)
  emit({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: '先把当前看板读一遍。' }] }
  })
  await wait(160)
  emit({
    type: 'assistant',
    message: {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: 'stub-tool-1',
          name: 'Read',
          input: { file_path: 'src/main/index.ts' }
        }
      ]
    }
  })
  await wait(160)
  emit({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'stub-tool-1', content: 'ok', is_error: false }]
    }
  })
  await wait(160)
  emit({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: '读完了，今天有 6 项待办。' }] }
  })
  await wait(160)
  emit({
    type: 'result',
    subtype: 'success',
    is_error: false,
    total_cost_usd: 0.001,
    duration_ms: 12,
    num_turns: 1
  })
}

function handleLine(line) {
  const text = line.trim()
  if (!text) return
  let message
  try {
    message = JSON.parse(text)
  } catch {
    return
  }

  if (message.type === 'user' && !started) {
    started = true
    void runFlow(promptFromMessage(message))
    return
  }
  if (message.type === 'control_response') {
    const response = message.response
    const pending = pendingPermissions.get(response?.request_id)
    if (pending) {
      pendingPermissions.delete(response.request_id)
      pending(response.response ?? response)
    }
  }
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index = buffer.indexOf('\n')
  while (index >= 0) {
    const line = buffer.slice(0, index)
    buffer = buffer.slice(index + 1)
    handleLine(line)
    index = buffer.indexOf('\n')
  }
})
process.stdin.on('end', () => {
  if (buffer.trim()) handleLine(buffer)
})
