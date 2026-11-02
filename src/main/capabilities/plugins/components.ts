import { existsSync } from 'node:fs'
import { join } from 'node:path'

export interface PluginComponents {
  components: string[]
  hasHooks: boolean
  hasMcp: boolean
}

/**
 * 插件目录的组件探测。
 * marketplace 安装与本机导入必须走同一份判断：两套标准会让「带 MCP 的插件」
 * 在导入路径上被当成普通插件，跳过启用前的信任确认。
 */
export function detectComponents(dir: string): PluginComponents {
  const has = (name: string): boolean => existsSync(join(dir, name))
  const components: string[] = []
  if (has('skills')) components.push('skills')
  if (has('commands')) components.push('commands')
  if (has('agents')) components.push('agents')
  if (has('hooks')) components.push('hooks')
  const hasHooks = has('hooks') || has(join('hooks', 'hooks.json')) || has('hooks.json')
  const hasMcp = has('.mcp.json') || has('mcp.json') || has('.mcp.jsonc')
  if (hasMcp) components.push('mcp')
  return { components, hasHooks, hasMcp }
}

/** 插件 id 形如 `name@market`；市场名可能为空（本地插件）。 */
export function splitPluginId(id: string): { name: string; market: string } {
  const at = id.lastIndexOf('@')
  return at >= 0 ? { name: id.slice(0, at), market: id.slice(at + 1) } : { name: id, market: '' }
}
