import { describe, expect, it } from 'vitest'
import type { ExternalMcpServerRecord } from '../../shared/ipc'
import { exportMcpConfig, parseMcpConfig } from './mcp-config'

const server = (over: Partial<ExternalMcpServerRecord>): ExternalMcpServerRecord => ({
  id: 'mcp-1',
  key: 'remote',
  name: 'Remote',
  description: '',
  transport: 'http',
  command: '',
  args: [],
  url: 'https://example.com/mcp',
  envKeys: [],
  headerKeys: [],
  source: 'manual',
  catalogId: '',
  version: '',
  enabled: true,
  trusted: true,
  toolNames: [],
  tools: [],
  lastTestAt: null,
  lastError: '',
  createdAt: 0,
  updatedAt: 0,
  ...over
})

describe('MCP JSON 配置', () => {
  it('解析 mcpServers 的 stdio / HTTP 条目并收集错误', () => {
    const parsed = parseMcpConfig(
      JSON.stringify({
        mcpServers: {
          Local: { command: 'node', args: ['x.js'], env: { TOKEN: 'abc' } },
          Remote: { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer x' } },
          Empty: {},
          Dual: { command: 'node', url: 'https://x' }
        }
      })
    )
    expect(parsed.inputs.map((input) => [input.name, input.transport])).toEqual([
      ['Local', 'stdio'],
      ['Remote', 'http']
    ])
    expect(parsed.inputs[0].env).toEqual({ TOKEN: 'abc' })
    expect(parsed.errors.map((error) => error.name)).toEqual(['Empty', 'Dual'])
  })

  it('拒绝非法 JSON 与空配置', () => {
    expect(parseMcpConfig('{').errors[0].message).toContain('JSON')
    expect(parseMcpConfig('{"mcpServers": {}}').errors[0].message).toContain('mcpServers')
  })

  it('导出保留 key、命令与禁用状态，但不导密钥值', () => {
    const exported = JSON.parse(
      exportMcpConfig([
        server({ headerKeys: ['Authorization'] }),
        server({
          id: 'mcp-2',
          key: 'local',
          name: 'Local',
          transport: 'stdio',
          command: 'node',
          args: ['x.js'],
          envKeys: ['TOKEN'],
          enabled: false
        })
      ])
    ) as Record<string, Record<string, Record<string, unknown>>>
    expect(exported.mcpServers.Remote).toMatchObject({
      url: 'https://example.com/mcp',
      disabled: false,
      headers: { Authorization: '' }
    })
    expect(exported.mcpServers.Local).toMatchObject({
      command: 'node',
      args: ['x.js'],
      disabled: true,
      env: { TOKEN: '' }
    })
    expect(JSON.stringify(exported)).not.toContain('secret-value')
  })
})
