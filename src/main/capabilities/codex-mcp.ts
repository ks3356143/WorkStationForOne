import type { McpToolApproval } from '../../shared/ipc'

export interface CodexMcpServerInput {
  key: string
  transport: 'stdio' | 'http'
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
  headers?: Record<string, string>
  tools: Array<{ name: string; approval: McpToolApproval }>
}

export interface CodexMcpServerConfig {
  key: string
  transport: 'stdio' | 'http'
  command: string
  args: string[]
  url: string
  envVars: string[]
  envHttpHeaders: Record<string, string>
  allowedTools: string[]
  disabledTools: string[]
}

export interface CodexMcpRuntime {
  servers: CodexMcpServerConfig[]
  /** 只进 app-server 子进程环境，不写 config.toml */
  env: Record<string, string>
  /** server key → tool name → 审批档位 */
  policies: Record<string, Record<string, McpToolApproval>>
  secretEnvNames: string[]
}

function envToken(value: string, max: number): string {
  const clean = value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, max)
  return clean || 'VALUE'
}

function uniqueEnvName(used: Set<string>, base: string): string {
  let name = base.slice(0, 62)
  let index = 2
  while (used.has(name)) {
    name = `${base.slice(0, 58)}_${index}`
    index += 1
  }
  used.add(name)
  return name
}

/**
 * 把启用的外部 MCP Server 转成 Codex app-server 可读的配置与审批策略。
 * 密钥只生成环境变量名，值留在返回值里由主进程注入子进程环境。
 */
export function buildCodexMcpRuntime(input: CodexMcpServerInput[]): CodexMcpRuntime {
  const used = new Set<string>()
  const runtime: CodexMcpRuntime = {
    servers: [],
    env: {},
    policies: {},
    secretEnvNames: []
  }

  for (const server of input) {
    const command = server.command?.trim() ?? ''
    const url = server.url?.trim() ?? ''
    if (server.transport === 'stdio' ? !command : !url) continue

    const prefix = envToken(server.key, 24)
    const envVars: string[] = []
    for (const [key, value] of Object.entries(server.env ?? {})) {
      if (!value.trim()) continue
      const name = uniqueEnvName(used, `WS_MCP_${prefix}_E_${envToken(key, 24)}`)
      envVars.push(name)
      runtime.env[name] = value
      runtime.secretEnvNames.push(name)
    }

    const envHttpHeaders: Record<string, string> = {}
    for (const [header, value] of Object.entries(server.headers ?? {})) {
      if (!value.trim()) continue
      const name = uniqueEnvName(used, `WS_MCP_${prefix}_H_${envToken(header, 24)}`)
      envHttpHeaders[header] = name
      runtime.env[name] = value
      runtime.secretEnvNames.push(name)
    }

    const policies: Record<string, McpToolApproval> = {}
    const allowedTools: string[] = []
    const disabledTools: string[] = []
    for (const tool of server.tools) {
      const name = tool.name.trim()
      if (!name) continue
      policies[name] = tool.approval
      if (tool.approval === 'allow') allowedTools.push(name)
      if (tool.approval === 'deny') disabledTools.push(name)
    }

    runtime.policies[server.key] = policies
    runtime.servers.push({
      key: server.key,
      transport: server.transport,
      command,
      args: [...(server.args ?? [])],
      url,
      envVars,
      envHttpHeaders,
      allowedTools,
      disabledTools
    })
  }

  return runtime
}
