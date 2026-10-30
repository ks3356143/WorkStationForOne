import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProviderRuntime } from '../providers'
import { buildCodexMcpRuntime } from '../capabilities/codex-mcp'
import { writeCodexProviderConfig } from './codex'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const provider: ProviderRuntime = {
  baseUrl: 'https://api.example.test/v1',
  model: 'deepseek/deepseek-v4.1-flash',
  token: 'secret-token',
  target: 'codex',
  wireApi: 'responses'
}

describe('Codex Provider 隔离', () => {
  it('写工具自己的 CODEX_HOME 配置，token 只在环境变量里', () => {
    const home = mkdtempSync(join(tmpdir(), 'wsfo-codex-home-'))
    dirs.push(home)
    writeCodexProviderConfig(home, provider)
    const config = readFileSync(join(home, 'config.toml'), 'utf8')
    expect(config).toContain('model_provider = "workstation"')
    expect(config).toContain('base_url = "https://api.example.test/v1"')
    expect(config).toContain('model = "deepseek/deepseek-v4.1-flash"')
    expect(config).toContain('wire_api = "responses"')
    expect(config).toContain('env_key = "WS_CODEX_PROVIDER_TOKEN"')
    expect(config).toContain('[shell_environment_policy]')
    expect(config).toContain('exclude = ["WS_CODEX_PROVIDER_TOKEN", "WS_CODEX_MCP_TOKEN"]')
    expect(config).not.toContain(provider.token)
    expect(config).not.toContain('mcp_servers.workstationforone')
  })

  it('有 MCP 端点时写入 HTTP 桥，只引用 Token 环境变量', () => {
    const home = mkdtempSync(join(tmpdir(), 'wsfo-codex-mcp-'))
    dirs.push(home)
    writeCodexProviderConfig(home, provider, {
      mcp: { url: 'http://127.0.0.1:4567/mcp' }
    })
    const config = readFileSync(join(home, 'config.toml'), 'utf8')
    expect(config).toContain('[mcp_servers.workstationforone]')
    expect(config).toContain('enabled = true')
    expect(config).toContain('url = "http://127.0.0.1:4567/mcp"')
    expect(config).toContain('bearer_token_env_var = "WS_CODEX_MCP_TOKEN"')
    expect(config).not.toContain(provider.token)
    expect(config).not.toContain('workstationforone-mcp-secret')
  })

  it('外部 MCP：密钥只出现环境变量名，工具策略写进 config', () => {
    const home = mkdtempSync(join(tmpdir(), 'wsfo-codex-external-'))
    dirs.push(home)
    const external = buildCodexMcpRuntime([
      {
        key: 'memory',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-memory'],
        env: { API_KEY: 'stdio-secret' },
        tools: [
          { name: 'search', approval: 'allow' },
          { name: 'save', approval: 'deny' },
          { name: 'read.notes', approval: 'ask' }
        ]
      },
      {
        key: 'remote',
        transport: 'http',
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer header-secret' },
        tools: []
      }
    ])

    writeCodexProviderConfig(home, provider, { external })
    const config = readFileSync(join(home, 'config.toml'), 'utf8')

    expect(config).toContain('[mcp_servers.memory]')
    expect(config).toContain('command = "npx"')
    expect(config).toContain('args = ["-y","@modelcontextprotocol/server-memory"]')
    expect(config).toContain('env_vars = ["WS_MCP_MEMORY_E_API_KEY"]')
    expect(config).toContain('default_tools_approval_mode = "prompt"')
    expect(config).toContain('disabled_tools = ["save"]')
    expect(config).toContain('[mcp_servers.memory.tools.search]')
    expect(config).toContain('approval_mode = "auto"')
    expect(config).toContain('[mcp_servers.remote]')
    expect(config).toContain('url = "https://example.com/mcp"')
    expect(config).toContain(
      'env_http_headers = { "Authorization" = "WS_MCP_REMOTE_H_AUTHORIZATION" }'
    )
    expect(config).toContain(
      'exclude = ["WS_CODEX_PROVIDER_TOKEN", "WS_CODEX_MCP_TOKEN", "WS_MCP_MEMORY_E_API_KEY", "WS_MCP_REMOTE_H_AUTHORIZATION"]'
    )
    expect(config).not.toContain('stdio-secret')
    expect(config).not.toContain('header-secret')
    expect(config).not.toContain('Bearer ')
  })

  it('外部 Server 出现非法工具名时用引号包住，避免破坏 TOML', () => {
    const home = mkdtempSync(join(tmpdir(), 'wsfo-codex-toolkey-'))
    dirs.push(home)
    const external = buildCodexMcpRuntime([
      {
        key: 'local',
        transport: 'stdio',
        command: 'node',
        tools: [{ name: '工具.名称', approval: 'allow' }]
      }
    ])

    writeCodexProviderConfig(home, provider, { external })
    const config = readFileSync(join(home, 'config.toml'), 'utf8')
    expect(config).toContain('[mcp_servers.local.tools."工具.名称"]')
  })
})
