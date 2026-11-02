import type { UpdateCandidate } from '../updates'
import type { CapabilityRepository } from '../../db/capabilities'
import type { AuditLog } from '../../db/audit'
import { splitPluginId } from './components'
import { syncPluginSkills } from './codex-skills'
import { listCodexInstalled } from './adapters'
import type { PluginSourceService } from './sources-service'

export interface UpdateDeps {
  repository: CapabilityRepository
  /** Claude 插件更新、Codex 重装与市场刷新 */
  plugins: {
    update: (pluginId: string) => Promise<{ version: string; enabled: boolean }>
  }
  sources: PluginSourceService
  mcp: { applyUpdate: (id: string) => Promise<{ version: string }> }
  codexHome: string
  audit?: AuditLog
}

export interface UpdateOutcome {
  updated: Array<{ kind: UpdateCandidate['kind']; id: string; name: string; version: string }>
  failed: Array<{ kind: UpdateCandidate['kind']; id: string; name: string; reason: string }>
}

/**
 * 应用更新候选。
 * 逐条独立执行：一条失败不影响其它条目，失败项保留在候选里供重试。
 */
export async function applyUpdates(
  candidates: UpdateCandidate[],
  deps: UpdateDeps
): Promise<UpdateOutcome> {
  const outcome: UpdateOutcome = { updated: [], failed: [] }
  // Codex 的市场快照要先刷新，否则重装拿到的还是旧版本
  const needsCodex = candidates.some((item) => item.kind === 'plugin' && item.agent === 'codex')
  if (needsCodex) {
    await deps.sources.upgradeCodexMarketplaces().catch((error: unknown) => {
      deps.audit?.record({
        at: Date.now(),
        domain: 'system',
        action: 'settings',
        title: 'plugin.marketplace-upgrade',
        source: 'ui',
        detail: error instanceof Error ? error.message.slice(0, 200) : '刷新 Codex 市场失败'
      })
    })
  }

  for (const item of candidates) {
    try {
      const version = await applyOne(item, deps)
      outcome.updated.push({ kind: item.kind, id: item.id, name: item.name, version })
    } catch (error) {
      outcome.failed.push({
        kind: item.kind,
        id: item.id,
        name: item.name,
        reason: error instanceof Error ? error.message : '更新失败'
      })
    }
  }

  if (deps.audit) {
    const detail =
      outcome.failed.length === 0
        ? `${outcome.updated.length} 个已更新`
        : `${outcome.updated.length} 个已更新 / ${outcome.failed.length} 个失败`
    deps.audit.record({
      at: Date.now(),
      domain: 'system',
      action: 'settings',
      title: 'capability.apply-updates',
      source: 'ui',
      detail
    })
  }
  return outcome
}

async function applyOne(item: UpdateCandidate, deps: UpdateDeps): Promise<string> {
  if (item.kind === 'mcp') {
    const updated = await deps.mcp.applyUpdate(item.id)
    return updated.version
  }

  if (item.agent === 'codex') {
    const { name, market } = splitPluginId(item.id)
    if (!market) throw new Error('缺少市场名，无法重装')
    await deps.sources.reinstallCodexPlugin(name, market)
    const installed = listCodexInstalled(deps.codexHome).find((plugin) => plugin.id === item.id)
    if (!installed) throw new Error('重装后没有在磁盘上找到该插件')
    const stored = deps.repository.findPlugin(item.id, 'codex')
    // 内容变了就重新复制 skill：停用状态下不复制，启用由用户再点
    if (stored?.enabled && installed.installPath) {
      syncPluginSkills({
        codexHome: deps.codexHome,
        pluginRoot: installed.installPath,
        pluginId: item.id
      })
    }
    deps.repository.upsertPlugin({
      id: item.id,
      name,
      description: '',
      version: installed.version,
      marketplace: market,
      installPath: installed.installPath ?? '',
      components: stored?.components ?? [],
      hasHooks: stored?.hasHooks ?? false,
      hasMcp: stored?.hasMcp ?? false,
      enabled: stored?.enabled ?? false,
      trusted: stored?.trusted ?? false,
      agent: 'codex'
    })
    return installed.version
  }

  const updated = await deps.plugins.update(item.id)
  return updated.version
}
