import type { PluginAgent } from '../../shared/ipc'
import { compareVersion } from './plugins/adapters'

export interface UpdateCandidate {
  kind: 'plugin' | 'mcp' | 'cli'
  id: string
  name: string
  agent?: PluginAgent
  current: string
  latest: string
  sourceName?: string
  source?: 'plugin' | 'mcp' | 'cli'
  note?: string
  command?: string
}

export interface PluginVersionInput {
  id: string
  name: string
  version: string
  latestVersion: string
  agent: PluginAgent
  sourceName?: string
  /** 来源未信任时跳过，只提示不参与更新 */
  sourceTrusted?: boolean
}

export interface McpVersionInput {
  id: string
  name: string
  currentVersion: string
  latestVersion: string
}

/**
 * 只返回有更新的候选，不执行任何安装。
 * 版本号缺失或无法比较时按「无更新」处理，避免误报。
 */
export function collectCandidates(
  plugins: PluginVersionInput[],
  mcp: McpVersionInput[]
): UpdateCandidate[] {
  const candidates: UpdateCandidate[] = []

  for (const plugin of plugins) {
    if (plugin.sourceTrusted === false) continue
    if (!plugin.latestVersion || !plugin.version) continue
    if (compareVersion(plugin.latestVersion, plugin.version) <= 0) continue
    candidates.push({
      kind: 'plugin',
      id: plugin.id,
      name: plugin.name,
      agent: plugin.agent,
      current: plugin.version,
      latest: plugin.latestVersion,
      source: 'plugin',
      ...(plugin.sourceName ? { sourceName: plugin.sourceName } : {})
    })
  }

  for (const item of mcp) {
    if (!item.latestVersion || !item.currentVersion) continue
    if (compareVersion(item.latestVersion, item.currentVersion) <= 0) continue
    candidates.push({
      kind: 'mcp',
      id: item.id,
      name: item.name,
      current: item.currentVersion,
      latest: item.latestVersion,
      source: 'mcp'
    })
  }

  return candidates
}

/** 提示条文案：按类型汇总数量。 */
export function summarizeCandidates(candidates: UpdateCandidate[]): string {
  if (candidates.length === 0) return ''
  const plugins = candidates.filter((item) => item.kind === 'plugin').length
  const mcp = candidates.filter((item) => item.kind === 'mcp').length
  const cli = candidates.filter((item) => item.kind === 'cli').length
  const parts: string[] = []
  if (plugins > 0) parts.push(`${plugins} 个插件`)
  if (mcp > 0) parts.push(`${mcp} 个 MCP`)
  if (cli > 0) parts.push(`${cli} 个本机 CLI`)
  return `${parts.join('、')}可更新`
}
