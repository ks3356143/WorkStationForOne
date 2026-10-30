import type { ExternalMcpServerRecord, SkillMarketEntry } from '../../../shared/ipc'

/** 一行一个 KEY=VALUE；空行与 # 注释跳过。 */
export function parseKeyValueLines(text: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const index = line.indexOf('=')
    if (index <= 0) continue
    const key = line.slice(0, index).trim()
    const value = line.slice(index + 1).trim()
    if (key && value) result[key] = value
  }
  return result
}

/** 编辑时只显示已保存的 key，值留空，提交时不会覆盖旧值。 */
export function keyPlaceholders(keys: string[]): string {
  return keys.map((key) => `${key}=`).join('\n')
}

export function filterMarket(entries: SkillMarketEntry[], query: string): SkillMarketEntry[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return entries
  return entries.filter((entry) =>
    `${entry.name} ${entry.description} ${entry.marketplace}`.toLowerCase().includes(needle)
  )
}

export function sortMarket(
  entries: SkillMarketEntry[],
  sort: 'popular' | 'name'
): SkillMarketEntry[] {
  return [...entries].sort((a, b) =>
    sort === 'popular'
      ? b.installCount - a.installCount || a.name.localeCompare(b.name)
      : a.name.localeCompare(b.name)
  )
}

export function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(value)
}

export function installedCatalogIds(servers: ExternalMcpServerRecord[]): Set<string> {
  return new Set(
    servers.map((server) => server.catalogId).filter((id): id is string => Boolean(id))
  )
}

export function mcpTarget(server: ExternalMcpServerRecord): string {
  return server.transport === 'http' ? server.url : `${server.command} ${server.args.join(' ')}`
}

/** 应用镜像名与官方保留名都显示为用户能看懂的 Claude 官方。 */
export function marketLabel(value: string): string {
  if (value === 'wsfo-official' || value === 'claude-plugins-official') return 'Claude 官方'
  if (value === 'local') return '本地'
  return value
}
