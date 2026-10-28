#!/usr/bin/env node
/**
 * 冒烟用的假 CLI：行为对齐 `claude -p --output-format stream-json --verbose`。
 * 分块回放并留出真实节奏的间隔——一次性喷完会让「等待动画」类断言来不及观察，
 * 也测不出流式追加是否真的生效。
 * 用法：WS_AGENT_CLI=<此文件路径>，应用会用它替代真实 claude。
 */
const chunks = []
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => chunks.push(chunk))
process.stdin.on('end', async () => {
  const prompt = chunks.join('').trim()
  const emit = (payload) => process.stdout.write(`${JSON.stringify(payload)}\n`)
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  if (prompt.includes('失败')) {
    emit({ type: 'system', subtype: 'init', model: 'stub-model', session_id: 'stub-fail' })
    await wait(120)
    emit({ type: 'result', subtype: 'error_during_execution', is_error: true, result: '模拟失败' })
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
})
