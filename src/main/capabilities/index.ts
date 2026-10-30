import type { AuditLog } from '../db/audit'
import type { CapabilityRepository } from '../db/capabilities'
import type { AgentCli } from '../agent/cli'
import type { BuiltinToolRecord, EnvironmentCheckRecord } from '../../shared/ipc'
import { MCP_TOOLS } from '../mcp/tools'
import { ClaudePluginService } from './claude-plugins'
import type { CodexMcpRuntime } from './codex-mcp'
import { McpServerService, type McpServerRuntime } from './mcp-servers'
import { checkEnvironment } from './environment'

export interface CapabilityCenter {
  plugins: ClaudePluginService
  mcp: McpServerService
  builtinTools: () => BuiltinToolRecord[]
  environment: (force?: boolean) => Promise<EnvironmentCheckRecord[]>
}

export interface AgentCapabilityRuntime {
  pluginDirs: () => string[]
  mcpServers: () => McpServerRuntime[]
  toolPolicy: () => { allowed: string[]; denied: string[] }
  codexMcp: () => CodexMcpRuntime
}

export function createCapabilityCenter(options: {
  repository: CapabilityRepository
  appDataDir: string
  audit?: AuditLog
  pluginCli?: AgentCli | null
  version?: string
}): CapabilityCenter {
  const plugins = new ClaudePluginService(options.repository, options.appDataDir, options.pluginCli)
  const mcp = new McpServerService(options.repository, options.version)
  return {
    plugins,
    mcp,
    builtinTools: () =>
      MCP_TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        domain: tool.domain,
        write: tool.write === true
      })),
    environment: (force = false) => checkEnvironment(force)
  }
}

export function agentCapabilityRuntime(center: CapabilityCenter): AgentCapabilityRuntime {
  return {
    pluginDirs: () => center.plugins.pluginDirs(),
    mcpServers: () => center.mcp.runtimeServers(),
    toolPolicy: () => center.mcp.claudeToolPolicy(),
    codexMcp: () => center.mcp.codexRuntime()
  }
}
