#!/usr/bin/env node
/**
 * 冒烟用的假 CLI：行为对齐 `claude -p --input-format stream-json
 * --output-format stream-json --verbose --permission-prompts host`。
 * 分块回放并留出真实节奏的间隔；支持发 can_use_tool 控制请求并等待宿主响应。
 * 用法：WS_AGENT_CLI=<此文件路径>，应用会用它替代真实 claude。
 */
const pendingPermissions = new Map()
const userMessages = []
const { writeFileSync } = require('node:fs')
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

/** 首条用户消息里的图片块；返回 MIME 列表，用于断言多模态输入。 */
function promptImages() {
  for (const message of userMessages) {
    if (message?.type !== 'user') continue
    const content = message?.message?.content
    if (!Array.isArray(content)) continue
    return content
      .filter((block) => block?.type === 'image')
      .map((block) => block?.source?.media_type)
      .filter((mime) => typeof mime === 'string')
  }
  return []
}

async function runFlow(prompt) {
  // 冒烟用：验证失败时界面展示的是可读文案而不是原始报错
  if (prompt.includes('触发登录失败')) {
    emit({ type: 'system', subtype: 'init', model: 'stub-model', session_id: 'stub-fail' })
    await wait(60)
    emit({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      num_turns: 1,
      result: 'Not logged in · Please run /login'
    })
    return
  }
  // Provider / 模型错误：验证界面能说清是模型、上下文、额度还是协议问题。
  const providerErrors = [
    ['模型不存在', 'API Error: 400 Model Not Exist'],
    ['上下文超长', "API Error: 400 This model's maximum context length is 65536 tokens"],
    ['余额不足', 'API Error: 402 Insufficient Balance'],
    [
      '协议错配',
      'unexpected status 404 Not Found: Unknown error, url: https://api.deepseek.com/anthropic/responses'
    ]
  ]
  const providerError = providerErrors.find(([match]) => prompt.includes(match))
  if (providerError) {
    emit({
      type: 'system',
      subtype: 'init',
      model: 'stub-model',
      session_id: 'stub-provider-error'
    })
    await wait(60)
    emit({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      num_turns: 1,
      result: providerError[1]
    })
    return
  }
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
    const ruleWrite = prompt.includes('规则写入')
    const autoWrite = prompt.includes('自动写入')
    const writeMode = prompt.includes('写任务') || approval || ruleWrite || autoWrite
    const title = approval
      ? 'MCP 审批写入'
      : ruleWrite
        ? 'MCP 规则写入'
        : autoWrite
          ? 'MCP 自动写入'
          : 'MCP 写入测试'
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate()
    ).padStart(2, '0')}`
    const toolName = writeMode ? 'tasks_create' : 'today_overview'
    const toolArgs = writeMode
      ? {
          title,
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
                  ? ruleWrite
                    ? 'MCP 规则写入：已创建。'
                    : autoWrite
                      ? 'MCP 自动写入：已创建。'
                      : approval
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

  if (prompt.includes('检查点写入')) {
    emit({ type: 'system', subtype: 'init', model: 'stub-model', session_id: 'stub-checkpoint' })
    await wait(80)
    emit({
      type: 'control_request',
      request_id: 'perm-checkpoint',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Edit',
        display_name: 'Edit',
        input: {
          file_path: 'checkpoint.txt',
          old_string: '原始内容',
          new_string: '改后内容'
        },
        tool_use_id: 'stub-checkpoint-tool',
        description: '写入检查点样例'
      }
    })
    const decision = await new Promise((resolve) =>
      pendingPermissions.set('perm-checkpoint', resolve)
    )
    if (decision?.behavior !== 'allow') {
      emit({
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: '检查点写入被拒绝。' }] }
      })
      emit({ type: 'result', subtype: 'success', is_error: false, num_turns: 1 })
      return
    }
    writeFileSync('checkpoint.txt', '改后内容', 'utf8')
    emit({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: '检查点写入完成。' }] }
    })
    emit({
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0,
      duration_ms: 8,
      num_turns: 1
    })
    return
  }

  if (prompt.includes('计划模式')) {
    emit({ type: 'system', subtype: 'init', model: 'stub-model', session_id: 'stub-plan' })
    await wait(80)
    const plan = process.argv.includes('plan')
    emit({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: plan ? '计划模式：只读。' : '计划模式：未启用。' }]
      }
    })
    emit({ type: 'result', subtype: 'success', is_error: false, num_turns: 1 })
    return
  }

  if (prompt.includes('图片上下文')) {
    emit({ type: 'system', subtype: 'init', model: 'stub-model', session_id: 'stub-image' })
    await wait(80)
    const images = promptImages()
    emit({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: images.length ? `图片：已收到 ${images.length} 张 ${images[0]}` : '图片：未注入'
          }
        ]
      }
    })
    emit({
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0,
      duration_ms: 8,
      num_turns: 1
    })
    return
  }

  if (prompt.includes('附件上下文')) {
    emit({ type: 'system', subtype: 'init', model: 'stub-model', session_id: 'stub-context' })
    await wait(80)
    const hasBlock = prompt.includes('<workspace_file path="smoke-note.txt">')
    const hasContent = prompt.includes('workspace smoke preview')
    emit({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: hasBlock
              ? `附件：已读取 smoke-note.txt（${hasContent ? '内容完整' : '内容缺失'}）`
              : '附件：未注入'
          }
        ]
      }
    })
    emit({
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0,
      duration_ms: 8,
      num_turns: 1
    })
    return
  }

  if (prompt.includes('帮我拟一条周报提醒')) {
    // 冒烟要在回合结束前验证命令面板的发送项处于禁用态，默认 640ms 会被界面操作追上
    emit({ type: 'system', subtype: 'init', model: 'stub-model', session_id: 'stub-palette' })
    await wait(1400)
    emit({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: '周报提醒已拟好。' }] }
    })
    emit({
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0.001,
      duration_ms: 1400,
      num_turns: 1
    })
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
        input: {
          questions: [
            {
              question: '部署到哪个环境？',
              header: '环境',
              multiSelect: false,
              options: [
                { label: 'Staging', description: '预发环境' },
                { label: 'Production', description: '生产环境' }
              ]
            },
            {
              question: '需要启用哪些检查？',
              header: '检查',
              multiSelect: true,
              options: [
                { label: '类型检查', description: 'tsc --noEmit' },
                { label: '单元测试', description: 'vitest run' }
              ]
            }
          ]
        },
        tool_use_id: 'stub-question-tool',
        description: '向用户提问'
      }
    })
    const decision = await new Promise((resolve) => pendingPermissions.set('question-1', resolve))
    const answers = decision?.updatedInput?.answers ?? {}
    emit({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text:
              decision?.behavior === 'deny'
                ? '问答被拒绝，未继续。'
                : `问答完成：${answers['部署到哪个环境？'] ?? '?'} / ${answers['需要启用哪些检查？'] ?? '?'}`
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

  if (prompt.includes('慢会话')) {
    emit({ type: 'system', subtype: 'init', model: 'stub-model', session_id: 'stub-slow' })
    await wait(100)
    emit({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: '慢会话开始。' }] }
    })
    // 留出足够窗口让冒烟在它结束前启动并完成另一个会话
    await wait(4200)
    emit({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: '慢会话结束。' }] }
    })
    emit({
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0.001,
      duration_ms: 4200,
      num_turns: 1
    })
    return
  }

  if (prompt.includes('并发审批')) {
    emit({
      type: 'system',
      subtype: 'init',
      model: 'stub-model',
      session_id: 'stub-approval-concurrent'
    })
    await wait(100)
    emit({
      type: 'assistant',
      message: { role: 'assistant', content: [{ type: 'text', text: '等待并发审批。' }] }
    })
    emit({
      type: 'control_request',
      request_id: 'perm-1',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Write',
        display_name: 'Write',
        input: { file_path: 'tmp/concurrent.txt', content: 'ok' },
        tool_use_id: 'stub-concurrent-tool',
        description: '并发审批写入'
      }
    })
    const decision = await new Promise((resolve) => pendingPermissions.set('perm-1', resolve))
    emit({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: decision?.behavior === 'allow' ? '并发审批已允许。' : '并发审批已拒绝。'
          }
        ]
      }
    })
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

  if (prompt.includes('连续审批')) {
    emit({
      type: 'system',
      subtype: 'init',
      model: 'stub-model',
      session_id: 'stub-permission-two'
    })
    await wait(100)
    emit({
      type: 'control_request',
      request_id: 'perm-1',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Write',
        display_name: 'Write',
        input: { file_path: 'tmp/first.txt', content: 'ok' },
        tool_use_id: 'stub-perm-1',
        description: '连续审批第一次'
      }
    })
    const first = await new Promise((resolve) => pendingPermissions.set('perm-1', resolve))
    emit({
      type: 'control_request',
      request_id: 'perm-2',
      request: {
        subtype: 'can_use_tool',
        tool_name: 'Write',
        display_name: 'Write',
        input: { file_path: 'tmp/second.txt', content: 'ok' },
        tool_use_id: 'stub-perm-2',
        description: '连续审批第二次'
      }
    })
    const second = await new Promise((resolve) => pendingPermissions.set('perm-2', resolve))
    const allowed = first?.behavior === 'allow' && second?.behavior === 'allow'
    emit({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: allowed ? '连续审批：两次均允许。' : '连续审批：未全部允许。'
          }
        ]
      }
    })
    emit({ type: 'result', subtype: 'success', is_error: false, num_turns: 1 })
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
              input: { file_path: 'tmp/stub.txt', content: 'ok' }
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

  if (prompt.includes('能力中心检查')) {
    emit({
      type: 'system',
      subtype: 'init',
      model: 'stub-model',
      session_id: 'stub-capability'
    })
    const pluginDirs = []
    const argv = process.argv.slice(2)
    for (let index = 0; index < argv.length; index += 1) {
      if (argv[index] === '--plugin-dir' && argv[index + 1]) pluginDirs.push(argv[index + 1])
    }
    const mcpIndex = argv.indexOf('--mcp-config')
    const mcpPath = mcpIndex >= 0 ? argv[mcpIndex + 1] : ''
    const promptToolIndex = argv.indexOf('--permission-prompt-tool')
    const promptTool = promptToolIndex >= 0 ? argv[promptToolIndex + 1] : ''
    const deniedIndex = argv.indexOf('--disallowedTools')
    const deniedTools = []
    if (deniedIndex >= 0) {
      for (let index = deniedIndex + 1; index < argv.length; index += 1) {
        if (argv[index].startsWith('--')) break
        deniedTools.push(argv[index])
      }
    }
    const appendIndex = argv.indexOf('--append-system-prompt')
    const appended = appendIndex >= 0 ? (argv[appendIndex + 1] ?? '') : ''
    let servers = []
    let serverTypes = []
    if (mcpPath) {
      try {
        const config = JSON.parse(readFileSync(mcpPath, 'utf8'))
        const entries = Object.entries(config?.mcpServers ?? {})
        servers = entries.map(([name]) => name)
        serverTypes = entries.map(
          ([name, value]) => `${name}=${value?.type ?? (value?.url ? 'http' : 'stdio')}`
        )
      } catch {
        servers = ['读取失败']
      }
    }
    emit({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: `能力中心：插件 ${pluginDirs.join('|') || '无'}；MCP ${servers.join('|') || '无'}；类型 ${serverTypes.join('|') || '无'}；审批 ${promptTool || '无'}；严格 ${argv.includes('--strict-mcp-config')}；禁用 ${deniedTools.join('|') || '无'}；优先级 ${appended.includes('[工具优先级]') ? '有' : '无'}；首选 ${(appended.match(/首选：/)?.[0] ?? '无').trim()}`
          }
        ]
      }
    })
    emit({
      type: 'result',
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0,
      duration_ms: 0,
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
    message: {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: '读完了，今天有 **6 项待办**。\n\n- 先处理 `重构 auth 模块`\n- 再看 [文档](https://example.com)\n\n```js\nconst done = 2\n```'
        }
      ]
    }
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
    userMessages.push(message)
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
