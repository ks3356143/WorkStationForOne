// Codex CLI 的冒烟替身：exec 回放 JSONL，app-server 回放 JSON-RPC。
// 只实现测试需要的协议，不调用模型、不读写用户配置。
const THREAD_ID = 'codex-stub-thread'
const isAppServer = process.argv[2] === 'app-server'

function runExec() {
  let input = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    input += chunk
  })
  process.stdin.on('end', () => {
    const prompt = input.trim()
    const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)

    setTimeout(() => {
      emit({ type: 'thread.started', thread_id: THREAD_ID })
      emit({ type: 'turn.started' })

      if (prompt.includes('失败')) {
        emit({ type: 'turn.failed', error: { message: '模拟 Codex 失败' } })
        process.exitCode = 1
        return
      }

      emit({
        type: 'item.started',
        item: {
          id: 'cmd_1',
          type: 'command_execution',
          command: 'Get-Content src/main/index.ts',
          aggregated_output: '',
          exit_code: null,
          status: 'in_progress'
        }
      })

      setTimeout(() => {
        emit({
          type: 'item.completed',
          item: {
            id: 'cmd_1',
            type: 'command_execution',
            command: 'Get-Content src/main/index.ts',
            aggregated_output: '入口文件已读取',
            exit_code: 0,
            status: 'completed'
          }
        })
        emit({
          type: 'item.completed',
          item: {
            id: 'msg_1',
            type: 'agent_message',
            text: `Codex 只读回复：入口文件已读取。\n工作目录：${process.cwd()}`
          }
        })
        emit({
          type: 'turn.completed',
          usage: {
            input_tokens: 12,
            cached_input_tokens: 0,
            cache_write_input_tokens: 0,
            output_tokens: 8,
            reasoning_output_tokens: 0
          }
        })
      }, 40)
    }, 20)
  })
}

function runAppServer() {
  const emit = (value) => process.stdout.write(`${JSON.stringify(value)}\n`)
  let buffer = ''
  let threadId = ''
  let turnSeq = 0
  let approval = null

  const reply = (id, result) => emit({ id, result })
  const fail = (id, message) => emit({ id, error: { code: -32000, message } })

  const finishTurn = (message) => {
    const id = `turn-${turnSeq}`
    const itemId = `msg_${turnSeq}`
    const midpoint = Math.max(1, Math.floor(message.length / 2))
    emit({
      method: 'item/agentMessage/delta',
      params: { threadId, turnId: id, itemId, delta: message.slice(0, midpoint) }
    })
    emit({
      method: 'item/agentMessage/delta',
      params: { threadId, turnId: id, itemId, delta: message.slice(midpoint) }
    })
    emit({
      method: 'item/completed',
      params: {
        threadId,
        turnId: id,
        completedAtMs: Date.now(),
        item: { id: itemId, type: 'agentMessage', text: message }
      }
    })
    emit({
      method: 'turn/completed',
      params: { threadId, turn: { id, status: 'completed', items: [] } }
    })
  }

  const finishWithCommand = (command, output) => {
    const id = `cmd_${turnSeq}`
    emit({
      method: 'item/started',
      params: {
        threadId,
        turnId: `turn-${turnSeq}`,
        startedAtMs: Date.now(),
        item: {
          id,
          type: 'commandExecution',
          command,
          cwd: process.cwd(),
          status: 'inProgress',
          aggregatedOutput: null,
          exitCode: null
        }
      }
    })
    setTimeout(() => {
      emit({
        method: 'item/completed',
        params: {
          threadId,
          turnId: `turn-${turnSeq}`,
          completedAtMs: Date.now(),
          item: {
            id,
            type: 'commandExecution',
            command,
            cwd: process.cwd(),
            status: 'completed',
            aggregatedOutput: output,
            exitCode: 0
          }
        }
      })
      finishTurn(`Codex 工作区回复：${output}。`)
    }, 30)
  }

  const askWrite = (prompt) => {
    const wantsFile = prompt.includes('改文件')
    const itemId = wantsFile ? 'file_write' : 'cmd_write'
    const requestId = wantsFile ? 9002 : 9001
    const method = wantsFile
      ? 'item/fileChange/requestApproval'
      : 'item/commandExecution/requestApproval'
    if (wantsFile) {
      emit({
        method: 'item/started',
        params: {
          threadId,
          turnId: `turn-${turnSeq}`,
          startedAtMs: Date.now(),
          item: {
            id: itemId,
            type: 'fileChange',
            status: 'inProgress',
            changes: [{ path: 'note.txt', kind: 'add', diff: '+hello' }]
          }
        }
      })
    } else {
      emit({
        method: 'item/started',
        params: {
          threadId,
          turnId: `turn-${turnSeq}`,
          startedAtMs: Date.now(),
          item: {
            id: itemId,
            type: 'commandExecution',
            command: 'Set-Content note.txt "hello"',
            cwd: process.cwd(),
            status: 'inProgress',
            aggregatedOutput: null,
            exitCode: null
          }
        }
      })
    }
    emit({
      id: requestId,
      method,
      params: {
        threadId,
        turnId: `turn-${turnSeq}`,
        itemId,
        startedAtMs: Date.now(),
        ...(wantsFile
          ? { reason: 'Codex 想新增 note.txt' }
          : { command: 'Set-Content note.txt "hello"', cwd: process.cwd() })
      }
    })
    approval = (result) => {
      approval = null
      const accepted = result.decision === 'accept'
      emit({
        method: 'item/completed',
        params: {
          threadId,
          turnId: `turn-${turnSeq}`,
          completedAtMs: Date.now(),
          item: wantsFile
            ? {
                id: itemId,
                type: 'fileChange',
                status: accepted ? 'completed' : 'declined',
                changes: [{ path: 'note.txt', kind: 'add', diff: '+hello' }]
              }
            : {
                id: itemId,
                type: 'commandExecution',
                command: 'Set-Content note.txt "hello"',
                cwd: process.cwd(),
                status: accepted ? 'completed' : 'declined',
                aggregatedOutput: accepted ? '已写入 note.txt' : '用户拒绝执行',
                exitCode: accepted ? 0 : null
              }
        }
      })
      finishTurn(accepted ? '已允许写入。' : '已拒绝写入。')
    }
  }

  const askPermissions = () => {
    emit({
      id: 9003,
      method: 'item/permissions/requestApproval',
      params: {
        threadId,
        turnId: `turn-${turnSeq}`,
        itemId: 'perm_1',
        startedAtMs: Date.now(),
        cwd: process.cwd(),
        reason: '需要访问网络',
        permissions: { network: { enabled: true }, fileSystem: null }
      }
    })
    approval = (result) => {
      approval = null
      const granted = result.permissions?.network?.enabled === true
      finishTurn(granted ? '已授予额外权限。' : '已拒绝额外权限。')
    }
  }

  const askMcp = (prompt) => {
    const write = prompt.includes('MCP 写') || prompt.includes('MCP写入')
    const tool = write ? 'tasks_create' : 'today_overview'
    const description = write
      ? '在 WorkStationForOne 创建任务（写，受任务域权限约束）。'
      : '读取今天的本地工作台概览（只读）。'
    emit({
      id: 9004,
      method: 'mcpServer/elicitation/request',
      params: {
        threadId,
        turnId: `turn-${turnSeq}`,
        serverName: 'workstationforone',
        mode: 'form',
        _meta: {
          codex_approval_kind: 'mcp_tool_call',
          persist: ['session', 'always'],
          tool_description: description,
          tool_params: write ? { title: 'stub task' } : {}
        },
        message: `Allow the workstationforone MCP server to run tool "${tool}"?`,
        requestedSchema: { type: 'object', properties: {} }
      }
    })
    approval = (result) => {
      approval = null
      const accepted = result.action === 'accept'
      finishTurn(accepted ? '已允许 MCP 调用。' : '已拒绝 MCP 调用。')
    }
  }

  const askExternalMcp = (prompt) => {
    const tool = prompt.includes('禁止') ? 'blocked' : prompt.includes('允许') ? 'search' : 'write'
    emit({
      id: 9005,
      method: 'mcpServer/elicitation/request',
      params: {
        threadId,
        turnId: `turn-${turnSeq}`,
        serverName: 'memory',
        mode: 'form',
        _meta: {
          codex_approval_kind: 'mcp_tool_call',
          tool_description: 'Memory 外部 MCP 工具。',
          tool_params: { query: 'stub' }
        },
        message: `Allow the memory MCP server to run tool "${tool}"?`,
        requestedSchema: { type: 'object', properties: {} }
      }
    })
    approval = (result) => {
      approval = null
      const accepted = result.action === 'accept'
      finishTurn(accepted ? '已允许外部 MCP。' : '已拒绝外部 MCP。')
    }
  }

  const startTurn = (prompt, resumed) => {
    turnSeq += 1
    const id = `turn-${turnSeq}`
    emit({
      method: 'turn/started',
      params: { threadId, turn: { id, status: 'inProgress', items: [] } }
    })

    setTimeout(() => {
      if (prompt.includes('失败')) {
        emit({
          method: 'turn/completed',
          params: {
            threadId,
            turn: {
              id,
              status: 'failed',
              items: [],
              error: { message: '模拟 Codex 失败', codexErrorInfo: null, additionalDetails: null }
            }
          }
        })
        return
      }
      if (prompt.includes('额外权限')) {
        askPermissions()
        return
      }
      if (prompt.includes('外部 MCP')) {
        askExternalMcp(prompt)
        return
      }
      if (prompt.includes('MCP 工具') || prompt.includes('MCP 写')) {
        askMcp(prompt)
        return
      }
      if (prompt.includes('写') || prompt.includes('改文件')) {
        askWrite(prompt)
        return
      }
      if (resumed) {
        finishTurn('已续接 Codex 线程。')
        return
      }
      finishWithCommand('Get-Content src/main/index.ts', '入口文件已读取')
    }, 20)
  }

  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    buffer += chunk
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      let message
      try {
        message = JSON.parse(line)
      } catch {
        continue
      }
      if (message.method) {
        if (message.method === 'initialize') {
          reply(message.id, {
            userAgent: 'workstation-for-one/0.0.0 (stub)',
            codexHome: process.env.CODEX_HOME ?? '',
            platformFamily: 'windows',
            platformOs: 'windows'
          })
        } else if (message.method === 'initialized') {
          // no-op
        } else if (message.method === 'thread/start') {
          threadId = THREAD_ID
          reply(message.id, {
            thread: { id: threadId },
            model: 'stub-model',
            modelProvider: 'workstation',
            approvalPolicy: 'on-request',
            sandbox: { type: 'workspaceWrite' }
          })
        } else if (message.method === 'thread/resume') {
          if (message.params?.threadId === 'missing-thread') {
            fail(message.id, 'thread not found')
            continue
          }
          threadId = 'codex-stub-resumed'
          reply(message.id, {
            thread: { id: threadId },
            model: 'stub-model',
            modelProvider: 'workstation',
            approvalPolicy: 'on-request',
            sandbox: { type: 'workspaceWrite' }
          })
        } else if (message.method === 'turn/start') {
          const prompt = message.params?.input?.find((item) => item.type === 'text')?.text ?? ''
          const resumed = prompt.includes('继续上次')
          reply(message.id, {
            turn: { id: `turn-${turnSeq + 1}`, status: 'inProgress', items: [] }
          })
          startTurn(prompt, resumed)
        } else {
          fail(message.id, `unsupported method ${message.method}`)
        }
        continue
      }
      if (message.id !== undefined && approval) {
        approval(message.result)
      }
    }
  })
}

if (isAppServer) runAppServer()
else runExec()
