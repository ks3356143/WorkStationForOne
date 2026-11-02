import type { AuditLog } from '../db/audit'
import type { CapabilityRepository } from '../db/capabilities'
import type { McpPolicyRepository } from '../db/mcp'
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
  /** 插件源与 Agent 归属的仓储；源服务与更新检查共用 */
  repository: CapabilityRepository
  builtinTools: () => BuiltinToolRecord[]
  /** 切换内置工具开关，返回最新清单；未知工具名抛错 */
  setBuiltinTool: (name: string, enabled: boolean) => BuiltinToolRecord[]
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
  /** 内置工具开关的仓储；省略时全部视为启用 */
  policy?: McpPolicyRepository
}): CapabilityCenter {
  const plugins = new ClaudePluginService(options.repository, options.appDataDir, options.pluginCli)
  const mcp = new McpServerService(options.repository, options.version)
  const listBuiltin = (): BuiltinToolRecord[] => {
    const disabled = new Set(options.policy?.disabledTools() ?? [])
    return MCP_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      domain: tool.domain,
      write: tool.write === true,
      enabled: !disabled.has(tool.name)
    }))
  }
  return {
    plugins,
    mcp,
    repository: options.repository,
    builtinTools: listBuiltin,
    setBuiltinTool: (name, enabled) => {
      if (!options.policy) throw new Error('内置工具开关不可用')
      options.policy.setToolEnabled(name, enabled)
      return listBuiltin()
    },
    environment: (force = false) => checkEnvironment(force)
  }
}

export function agentCapabilityRuntime(center: CapabilityCenter): AgentCapabilityRuntime {
  return {
    pluginDirs: () => center.plugins.pluginDirs(),
    mcpServers: () => center.mcp.runtimeServers('claude'),
    toolPolicy: () => center.mcp.claudeToolPolicy(),
    codexMcp: () => center.mcp.codexRuntime()
  }
}
