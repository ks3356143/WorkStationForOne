import { describe, expect, it } from 'vitest'
import { buildCodexMcpRuntime } from './codex-mcp'

describe('Codex 外部 MCP 运行时', () => {
  it('把 stdio / HTTP Server 转成配置条目，密钥只生成环境变量名', () => {
    const runtime = buildCodexMcpRuntime([
      {
        key: 'memory',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-memory'],
        env: { API_KEY: 'stdio-secret' },
        tools: [
          { name: 'search', approval: 'allow' },
          { name: 'save', approval: 'deny' },
          { name: 'read', approval: 'ask' }
        ]
      },
      {
        key: 'remote',
        transport: 'http',
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer header-secret' },
        tools: [{ name: 'fetch', approval: 'ask' }]
      }
    ])

    expect(runtime.servers).toHaveLength(2)
    const stdio = runtime.servers[0]
    expect(stdio).toMatchObject({
      key: 'memory',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
      allowedTools: ['search'],
      disabledTools: ['save']
    })
    expect(stdio.envVars).toEqual(['WS_MCP_MEMORY_E_API_KEY'])
    expect(runtime.env.WS_MCP_MEMORY_E_API_KEY).toBe('stdio-secret')

    const http = runtime.servers[1]
    expect(http.envHttpHeaders).toEqual({ Authorization: 'WS_MCP_REMOTE_H_AUTHORIZATION' })
    expect(runtime.env.WS_MCP_REMOTE_H_AUTHORIZATION).toBe('Bearer header-secret')
    expect(runtime.secretEnvNames).toEqual([
      'WS_MCP_MEMORY_E_API_KEY',
      'WS_MCP_REMOTE_H_AUTHORIZATION'
    ])
    expect(runtime.policies).toEqual({
      memory: { search: 'allow', save: 'deny', read: 'ask' },
      remote: { fetch: 'ask' }
    })
  })

  it('同名环境变量跨 Server 不互相覆盖', () => {
    const runtime = buildCodexMcpRuntime([
      {
        key: 'a',
        transport: 'stdio',
        command: 'node',
        env: { TOKEN: 'one' },
        tools: []
      },
      {
        key: 'a',
        transport: 'stdio',
        command: 'node',
        env: { TOKEN: 'two' },
        tools: []
      }
    ])

    expect(runtime.secretEnvNames).toHaveLength(2)
    expect(runtime.secretEnvNames[0]).not.toBe(runtime.secretEnvNames[1])
    expect(Object.values(runtime.env).sort()).toEqual(['one', 'two'])
  })

  it('跳过缺少命令或 URL 的条目，忽略空白工具名与空密钥', () => {
    const runtime = buildCodexMcpRuntime([
      { key: 'broken', transport: 'stdio', tools: [] },
      { key: 'empty-url', transport: 'http', url: '  ', tools: [] },
      {
        key: 'ok',
        transport: 'stdio',
        command: 'node',
        env: { EMPTY: '  ' },
        tools: [{ name: ' ', approval: 'allow' }]
      }
    ])

    expect(runtime.servers.map((server) => server.key)).toEqual(['ok'])
    expect(runtime.servers[0].envVars).toEqual([])
    expect(runtime.secretEnvNames).toEqual([])
    expect(runtime.policies.ok).toEqual({})
  })
})
