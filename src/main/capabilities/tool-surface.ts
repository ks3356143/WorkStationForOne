import type {
  AgentKind,
  BuiltinToolRecord,
  ToolSurfaceBundle,
  ToolSurfaceRecord
} from '../../shared/ipc'
import {
  buildToolPriorityPrompt,
  claudeDisabledTools,
  codexDeniedTools,
  codexFlags,
  nativeTools
} from '../../shared/tool-surface'
import type { CapabilityRepository } from '../db/capabilities'
import type { ToolPrefRepository } from '../db/tool-prefs'

export interface NativeToolPolicy {
  disabledClaudeTools: string[]
  codexFlags: string[]
  codexDeniedTools: string[]
}

/**
 * 统一工具面：原生工具开关 + 启用且信任的 MCP / 技能，按偏好排序。
 * 数据桥工具单独返回，保持现有 MCP 域权限管理。
 */
export class ToolSurfaceService {
  constructor(
    private readonly prefs: ToolPrefRepository,
    private readonly capabilities: CapabilityRepository,
    private readonly builtin: () => BuiltinToolRecord[]
  ) {}

  bundle(): ToolSurfaceBundle {
    return {
      claude: this.forAgent('claude'),
      codex: this.forAgent('codex')
    }
  }

  forAgent(agent: AgentKind): ToolSurfaceRecord {
    const disabled = new Set(this.prefs.disabledNative(agent))
    const order = this.prefs.order(agent)
    const preferred = this.prefs.preferred(agent)
    const mcp = this.capabilities
      .listMcpServers()
      .filter((server) => server.targets === 'both' || server.targets === agent)
      .map((server) => ({
        id: `mcp:${server.id}`,
        name: server.name,
        enabled: server.enabled && server.trusted,
        preferred: preferred.has(`mcp:${server.id}`),
        tools: server.tools.map((tool) => tool.name),
        sortOrder: order.get(`mcp:${server.id}`)
      }))
      .sort((a, b) => this.compare(a, b))
    const skills = this.capabilities
      .listPlugins(agent)
      .map((plugin) => ({
        id: `skill:${plugin.id}`,
        name: plugin.name,
        enabled: plugin.enabled && plugin.trusted,
        preferred: preferred.has(`skill:${plugin.id}`),
        sortOrder: order.get(`skill:${plugin.id}`)
      }))
      .sort((a, b) => this.compare(a, b))

    return {
      agent,
      native: nativeTools(agent).map((group) => ({
        id: group.id,
        name: group.name,
        description: group.description,
        enabled: !disabled.has(group.id),
        ...(group.warning ? { warning: group.warning } : {})
      })),
      mcp: mcp.map((server) => ({
        id: server.id,
        name: server.name,
        enabled: server.enabled,
        preferred: server.preferred,
        tools: server.tools
      })),
      skills: skills.map((skill) => ({
        id: skill.id,
        name: skill.name,
        enabled: skill.enabled,
        preferred: skill.preferred
      })),
      builtin: this.builtin()
    }
  }

  setNative(agent: AgentKind, id: string, enabled: boolean): ToolSurfaceBundle {
    if (!nativeTools(agent).some((group) => group.id === id)) throw new Error('原生工具不存在')
    this.prefs.setNative(agent, id, enabled)
    return this.bundle()
  }

  /** 首选只作用于 MCP / 技能；原生工具用开关表达，不接受首选标记。 */
  setPreferred(agent: AgentKind, key: string, preferred: boolean): ToolSurfaceBundle {
    if (!key.startsWith('mcp:') && !key.startsWith('skill:')) {
      throw new Error('只有 MCP 与技能可以设为首选')
    }
    this.prefs.setPreferred(agent, key, preferred)
    return this.bundle()
  }

  move(agent: AgentKind, key: string, direction: 'up' | 'down'): ToolSurfaceBundle {
    const surface = this.forAgent(agent)
    const list = [...surface.mcp, ...surface.skills]
    const index = list.findIndex((item) => item.id === key)
    if (index < 0) throw new Error('工具项不存在')
    const target = direction === 'up' ? index - 1 : index + 1
    if (target < 0 || target >= list.length) return this.bundle()
    // 首选始终置顶：跨组的移动写进去也会被排序抹平，直接不写。
    const from = list[index]
    const to = list[target]
    if (!from || !to || from.preferred !== to.preferred) return this.bundle()
    const keys = list.map((item) => item.id)
    const swap = keys[index]
    keys[index] = keys[target] ?? ''
    keys[target] = swap ?? ''
    this.prefs.setOrder(agent, keys)
    return this.bundle()
  }

  nativePolicy(agent: AgentKind): NativeToolPolicy {
    const disabled = this.prefs.disabledNative(agent)
    return {
      disabledClaudeTools: agent === 'claude' ? claudeDisabledTools(disabled) : [],
      codexFlags: agent === 'codex' ? codexFlags(disabled) : [],
      codexDeniedTools: agent === 'codex' ? codexDeniedTools(disabled) : []
    }
  }

  priorityPrompt(agent: AgentKind): string {
    const surface = this.forAgent(agent)
    return buildToolPriorityPrompt(agent, {
      mcp: surface.mcp
        .filter((server) => server.enabled)
        .map((server) => ({
          name: server.name,
          tools: server.tools,
          preferred: server.preferred
        })),
      skills: surface.skills
        .filter((skill) => skill.enabled)
        .map((skill) => ({ name: skill.name, preferred: skill.preferred }))
    })
  }

  /** 删除 MCP / 插件后清掉排序行，避免残留键继续占位。 */
  remove(agent: AgentKind, key: string): void {
    this.prefs.remove(agent, key)
  }

  /** 首选项置顶；同组内仍按排序值、再按名称稳定排序。 */
  private compare(
    a: { name: string; sortOrder: number | undefined; preferred: boolean },
    b: { name: string; sortOrder: number | undefined; preferred: boolean }
  ): number {
    if (a.preferred !== b.preferred) return a.preferred ? -1 : 1
    const orderA = a.sortOrder ?? Number.MAX_SAFE_INTEGER
    const orderB = b.sortOrder ?? Number.MAX_SAFE_INTEGER
    if (orderA !== orderB) return orderA - orderB
    return a.name.localeCompare(b.name)
  }
}
