#!/usr/bin/env node
/**
 * 冒烟 / 单测用的最小 stdio MCP Server：
 * initialize → notifications/initialized → tools/list，返回两个假工具。
 */
let buffer = ''

const send = (payload) => process.stdout.write(`${JSON.stringify(payload)}\n`)

function handle(message) {
  if (message?.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'stub-mcp', version: '1.0.0' }
      }
    })
    return
  }
  if (message?.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        tools: [
          {
            name: 'echo',
            description: 'Echo text back',
            inputSchema: { type: 'object' },
            annotations: { readOnlyHint: true, destructiveHint: false }
          },
          {
            name: 'stub_status',
            description: 'Return stub status',
            inputSchema: { type: 'object' },
            annotations: { readOnlyHint: true, destructiveHint: false }
          }
        ]
      }
    })
    return
  }
  if (message?.id !== undefined) {
    send({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32601, message: `unsupported method: ${message?.method ?? 'unknown'}` }
    })
  }
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index = buffer.indexOf('\n')
  while (index >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (line) {
      try {
        handle(JSON.parse(line))
      } catch {
        // 非 JSON 行忽略
      }
    }
    index = buffer.indexOf('\n')
  }
})
process.stdin.on('end', () => process.exit(0))
