import { createServer } from 'node:http'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { probeMcpServer } from './mcp-client'

const STUB = join(process.cwd(), 'scripts', 'stub-mcp-server.cjs')
const servers: ReturnType<typeof createServer>[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve())
        })
    )
  )
})

describe('MCP 连接探测', () => {
  it('stdio：initialize 后列出工具', async () => {
    const result = await probeMcpServer({
      transport: 'stdio',
      command: process.execPath,
      args: [STUB],
      version: 'test'
    })
    expect(result.tools.map((tool) => tool.name)).toEqual(['echo', 'stub_status'])
    expect(result.tools.every((tool) => tool.readOnly)).toBe(true)
  })

  it('stdio：找不到命令时明确报错', async () => {
    await expect(
      probeMcpServer({
        transport: 'stdio',
        command: 'definitely-not-a-command-wsfo',
        version: 'test',
        timeoutMs: 2000
      })
    ).rejects.toThrow(/找不到 MCP 命令/)
  })

  it('http：携带 session id 完成 initialize 与 tools/list', async () => {
    const received: string[] = []
    const server = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', () => {
        const message = JSON.parse(body) as { id?: number; method?: string }
        received.push(`${message.method}:${req.headers['mcp-session-id'] ?? ''}`)
        res.setHeader('content-type', 'application/json')
        if (message.method === 'initialize') {
          res.setHeader('mcp-session-id', 'session-1')
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: message.id,
              result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: {} }
            })
          )
          return
        }
        if (message.method === 'notifications/initialized') {
          res.statusCode = 202
          res.end()
          return
        }
        if (message.method === 'tools/list') {
          res.end(
            JSON.stringify({
              jsonrpc: '2.0',
              id: message.id,
              result: {
                tools: [
                  {
                    name: 'remote_tool',
                    description: 'demo',
                    annotations: { readOnlyHint: true }
                  }
                ]
              }
            })
          )
          return
        }
        res.statusCode = 404
        res.end()
      })
    })
    servers.push(server)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('测试服务器没有端口')

    const result = await probeMcpServer({
      transport: 'http',
      url: `http://127.0.0.1:${address.port}/mcp`,
      headers: { Authorization: 'Bearer test' },
      version: 'test'
    })
    expect(result.tools.map((tool) => tool.name)).toEqual(['remote_tool'])
    expect(result.tools[0].readOnly).toBe(true)
    expect(received).toEqual([
      'initialize:',
      'notifications/initialized:session-1',
      'tools/list:session-1'
    ])
  })
})
