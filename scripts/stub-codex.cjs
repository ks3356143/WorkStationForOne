// Codex CLI 的 JSONL 冒烟替身：只回放协议，不调用模型、不读写用户配置。
const THREAD_ID = 'codex-stub-thread'

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
        item: { id: 'msg_1', type: 'agent_message', text: 'Codex 只读回复：入口文件已读取。' }
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
