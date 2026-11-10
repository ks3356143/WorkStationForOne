import { join } from 'node:path'
import type { AuditLog } from '../db/audit'
import type { CapabilityRepository } from '../db/capabilities'
import type { McpPolicyRepository } from '../db/mcp'
import type { AgentCli } from '../agent/cli'
import type { BuiltinToolRecord, EnvironmentCheckRecord } from '../../shared/ipc'
import { MCP_TOOLS } from '../mcp/tools'
import { ClaudePluginService } from './claude-plugins'
import type { CodexMcpRuntime } from './codex-mcp'
import { McpServerService, type McpOAuthDeps, type McpServerRuntime } from './mcp-servers'
import type { ToolPrefRepository } from '../db/tool-prefs'
import { checkEnvironment } from './environment'
import { createRuntimeService, type RuntimeService } from './runtimes'
import { ToolSurfaceService } from './tool-surface'

export interface CapabilityCenter {
  plugins: ClaudePluginService
  mcp: McpServerService
  /** 插件源与 Agent 归属的仓储；源服务与更新检查共用 */
  repository: CapabilityRepository
  /** 应用数据根目录与 Codex 私有 home，导入时用来计算落点 */
  agentDir: string
  codexHome: string
  builtinTools: () => BuiltinToolRecord[]
  /** 切换内置工具开关，返回最新清单；未知工具名抛错 */
  setBuiltinTool: (name: string, enabled: boolean) => BuiltinToolRecord[]
  /** 按 Agent 的统一工具面（原生 / MCP / 技能 / 数据桥） */
  toolSurface: ToolSurfaceService
  /** 环境依赖 CLI：双源状态、更新检查、托管安装与启动改写 */
  runtimeService: RuntimeService
  environment: (force?: boolean) => Promise<EnvironmentCheckRecord[]>
}

export interface AgentCapabilityRuntime {
  pluginDirs: () => string[]
  mcpServers: () => Promise<McpServerRuntime[]>
  toolPolicy: () => { allowed: string[]; denied: string[] }
  codexMcp: () => Promise<CodexMcpRuntime>
  toolSurface: ToolSurfaceService
  runtimePathPrefix: () => string
}

export function createCapabilityCenter(options: {
  repository: CapabilityRepository
  appDataDir: string
  audit?: AuditLog
  pluginCli?: AgentCli | null
  version?: string
  oauth?: McpOAuthDeps
  /** 内置工具开关的仓储；省略时全部视为启用 */
  policy?: McpPolicyRepository
  /** 工具面偏好仓储；省略时原生全部启用、MCP / 技能按名称排序 */
  toolPrefs: ToolPrefRepository
}): CapabilityCenter {
  const plugins = new ClaudePluginService(options.repository, options.appDataDir, options.pluginCli)
  const runtimeService = createRuntimeService({
    dataDir: options.appDataDir,
    repository: options.repository
  })
  const mcp = new McpServerService(
    options.repository,
    options.version,
    options.oauth,
    runtimeService
  )
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
    agentDir: options.appDataDir,
    codexHome: join(options.appDataDir, 'codex-home'),
    builtinTools: listBuiltin,
    setBuiltinTool: (name, enabled) => {
      if (!options.policy) throw new Error('内置工具开关不可用')
      options.policy.setToolEnabled(name, enabled)
      return listBuiltin()
    },
    toolSurface: new ToolSurfaceService(options.toolPrefs, options.repository, listBuiltin),
    runtimeService,
    environment: (force = false) => checkEnvironment(force)
  }
}

export function agentCapabilityRuntime(center: CapabilityCenter): AgentCapabilityRuntime {
  return {
    pluginDirs: () => center.plugins.pluginDirs(),
    mcpServers: () => center.mcp.runtimeServers('claude'),
    toolPolicy: () => center.mcp.claudeToolPolicy(),
    codexMcp: () => center.mcp.codexRuntime(),
    toolSurface: center.toolSurface,
    runtimePathPrefix: () => center.runtimeService.pathPrefix()
  }
}
