import { ipcMain } from 'electron'
import type { CapabilityCenter } from '../capabilities'
import type { AuditLog } from '../db/audit'
import type { InstalledPluginRecord } from '../../shared/ipc'
import { IPC_CHANNELS } from '../../shared/ipc'
import type { PluginSourceService } from '../capabilities/plugins/sources-service'
import type { UpdateChecker } from '../capabilities/plugins/update-checker'
import { applyUpdates } from '../capabilities/plugins/apply-updates'
import type { UpdateCandidate } from '../capabilities/updates'
import {
  copyPluginSnapshot,
  importLocal,
  scanForImport
} from '../capabilities/plugins/local-import'
import { detectComponents, splitPluginId } from '../capabilities/plugins/components'
import { scanClaudeLocal, scanCodexLocal } from '../capabilities/plugins/local-scan'
import { enablePluginForAgent } from '../capabilities/plugins/enable'
import {
  removeSyncedSkills,
  syncedSkillsOf,
  syncPluginSkills
} from '../capabilities/plugins/codex-skills'
import { listCodexInstalled, reconcile } from '../capabilities/plugins/adapters'
import { assertId, assertRecord } from '../validate'
import { recordSettings } from './settings-audit'

const IPC = IPC_CHANNELS
/** 插件与 MCP 的 id 含 `name@market` 形式，比通用上限宽。 */
const MAX_ID = 240
const assertLongId = (value: unknown, label: string) => assertId(value, label, MAX_ID)
const MAX_CANDIDATES = 200

/**
 * 更新候选来自渲染层，必须重新校验：id 会拼进 CLI 参数，
 * kind / agent 决定走哪条更新路径，任何一项不合法就整批拒绝。
 */
function assertCandidates(value: unknown): UpdateCandidate[] {
  if (!Array.isArray(value)) throw new TypeError('更新列表必须是数组')
  if (value.length > MAX_CANDIDATES) throw new TypeError('更新条目过多')
  return value.map((entry) => {
    const item = assertRecord(entry, '更新条目')
    const kind = item.kind === 'plugin' || item.kind === 'mcp' ? item.kind : null
    if (!kind) throw new TypeError('更新类型无效')
    const agent = item.agent === 'codex' ? 'codex' : item.agent === 'claude' ? 'claude' : undefined
    if (kind === 'plugin' && !agent) throw new TypeError('插件更新缺少 Agent 归属')
    return {
      kind,
      id: assertLongId(item.id, '更新 id'),
      name: typeof item.name === 'string' ? item.name.slice(0, 80) : '',
      current: typeof item.current === 'string' ? item.current.slice(0, 40) : '',
      latest: typeof item.latest === 'string' ? item.latest.slice(0, 40) : '',
      ...(agent ? { agent } : {})
    }
  })
}

/**
 * 插件源、本机扫描与更新检查的 IPC。
 * 与能力中心分开注册，避免 registerCapabilityHandlers 的签名继续膨胀。
 */
export function registerPluginHandlers(
  center: CapabilityCenter,
  sources: PluginSourceService,
  checker: UpdateChecker,
  audit?: AuditLog
): void {
  const record = (title: string, detail: string) => recordSettings(audit, title, detail)

  ipcMain.handle(IPC.capabilityPluginSources, () => sources.list())

  ipcMain.handle(IPC.capabilityPluginSourceAdd, async (_event, value: unknown) => {
    const input = assertRecord(value, '插件源参数')
    const name = typeof input.name === 'string' ? input.name : ''
    const url = typeof input.url === 'string' ? input.url : ''
    const ref = typeof input.ref === 'string' ? input.ref : ''
    if (!name || name.length > 60) throw new TypeError('源名称无效')
    if (!url || url.length > 2000) throw new TypeError('源地址无效')
    const saved = await sources.add({ name, url, ref })
    center.plugins.invalidateMarketCache()
    record('plugin-source.add', `${saved.name} · ${saved.url}`)
    return saved
  })

  ipcMain.handle(IPC.capabilityPluginSourceRefresh, async (_event, id: unknown) => {
    const target = assertLongId(id, '源 id')
    const result = await sources.refresh(target)
    center.plugins.invalidateMarketCache()
    record('plugin-source.refresh', `${result.source.name} · ${result.plugins.length} plugins`)
    return result.source
  })

  ipcMain.handle(IPC.capabilityPluginSourceRemove, async (_event, id: unknown) => {
    const target = assertLongId(id, '源 id')
    await sources.remove(target)
    center.plugins.invalidateMarketCache()
    record('plugin-source.remove', target)
  })

  ipcMain.handle(IPC.capabilityPluginScanLocal, () => scanForImport())

  /**
   * 已安装插件统一列表：Claude 以数据库为准，Codex 合并磁盘现状。
   * 磁盘上有但库里没有的顺手补录（adopted），库里有没有磁盘的标 missingOnDisk。
   */
  ipcMain.handle(IPC.capabilityPluginInstalled, () => {
    const result: InstalledPluginRecord[] = []
    for (const plugin of center.repository.listPlugins('claude')) {
      result.push({
        id: plugin.id,
        name: plugin.name,
        market: plugin.marketplace,
        version: plugin.version,
        agent: 'claude',
        enabled: plugin.enabled,
        trusted: plugin.trusted,
        missingOnDisk: false,
        adopted: false,
        components: plugin.components,
        hasHooks: plugin.hasHooks,
        hasMcp: plugin.hasMcp,
        installPath: plugin.installPath,
        syncedSkills: []
      })
    }

    const merged = reconcile(
      center.repository.listPlugins('codex'),
      listCodexInstalled(center.codexHome),
      'codex'
    )
    for (const plugin of merged) {
      const { name, market } = splitPluginId(plugin.id)
      // 磁盘有、库里没有时补录，供启停与卸载使用
      if (!plugin.inDb) {
        center.repository.upsertPlugin({
          id: plugin.id,
          name,
          description: '',
          version: plugin.version,
          marketplace: market,
          installPath: plugin.installPath ?? '',
          components: [],
          hasHooks: false,
          hasMcp: false,
          enabled: plugin.enabled,
          trusted: false,
          agent: 'codex'
        })
      }
      result.push({
        id: plugin.id,
        name: plugin.name,
        market: plugin.market,
        version: plugin.version,
        agent: 'codex',
        enabled: plugin.enabled,
        trusted: plugin.trusted,
        missingOnDisk: plugin.missingOnDisk,
        adopted: !plugin.inDb,
        components: [],
        hasHooks: false,
        hasMcp: false,
        installPath: plugin.installPath ?? '',
        syncedSkills: syncedSkillsOf(center.codexHome, plugin.id)
      })
    }
    return result
  })

  ipcMain.handle(IPC.capabilityPluginImport, async (_event, value: unknown) => {
    const input = assertRecord(value, '导入参数')
    const agent = input.agent === 'codex' ? 'codex' : input.agent === 'claude' ? 'claude' : null
    if (!agent) throw new TypeError('Agent 无效')
    const markets = Array.isArray(input.markets)
      ? input.markets.filter((item): item is string => typeof item === 'string')
      : []
    const plugins = Array.isArray(input.plugins)
      ? input.plugins.filter((item): item is string => typeof item === 'string')
      : []
    const scan = agent === 'claude' ? scanClaudeLocal() : scanCodexLocal()
    const outcome = await importLocal({ agent, markets, plugins }, scan, {
      repository: center.repository,
      agentDir: center.agentDir,
      codexHome: center.codexHome,
      registerMarket: async (market, root) => {
        await sources.register(market, root)
      },
      installFromDirectory: (target, source, meta) => {
        const dir = copyPluginSnapshot(
          target,
          source,
          {
            agentDir: center.agentDir,
            codexHome: center.codexHome
          },
          {
            id: meta.id,
            name: meta.name,
            market: meta.market,
            version: meta.version,
            enabled: false,
            installPath: source
          }
        )
        const detected = detectComponents(dir)
        center.repository.upsertPlugin({
          id: meta.id,
          name: meta.name,
          description: '',
          version: meta.version,
          marketplace: meta.market,
          installPath: dir,
          components: detected.components,
          hasHooks: detected.hasHooks,
          hasMcp: detected.hasMcp,
          enabled: false,
          trusted: false,
          agent: target
        })
        // Codex 只扫描 <CODEX_HOME>/skills，软链不生效，必须复制一份
        if (target === 'codex') {
          syncPluginSkills({
            codexHome: center.codexHome,
            pluginRoot: dir,
            pluginId: meta.id
          })
        }
      }
    })
    record(
      'plugin.import',
      `${agent} · ${outcome.importedMarkets.length} markets / ${outcome.importedPlugins.length} plugins`
    )
    return outcome
  })

  ipcMain.handle(IPC.capabilityUpdatesCheck, () => checker.check())

  /**
   * 逐条应用更新。渲染层把候选原样传回来，主进程据此分发到
   * Claude 插件 / Codex 重装 / 内置 MCP；单条失败不影响其它条目。
   */
  ipcMain.handle(IPC.capabilityUpdatesApply, async (_event, value: unknown) => {
    const candidates = assertCandidates(value)
    const outcome = await applyUpdates(candidates, {
      repository: center.repository,
      plugins: { update: (id) => center.plugins.update(id) },
      sources,
      mcp: { applyUpdate: (id) => center.mcp.applyUpdate(id) },
      codexHome: center.codexHome,
      audit
    })
    record(
      'capability.apply-updates',
      `${outcome.updated.length} updated / ${outcome.failed.length} failed`
    )
    return outcome
  })

  /**
   * 插件启停：Claude 走 plugins.setEnabled；Codex 改写私有 config.toml 的 enabled
   * 并同步 / 删除 CODEX_HOME/skills 副本（逻辑收敛在 enablePluginForAgent）。
   */
  ipcMain.handle(IPC.capabilityPluginSetEnabled, (_event, value: unknown) => {
    const input = assertRecord(value, '插件启停参数')
    const id = assertLongId(input.id, '插件 id')
    const agent = input.agent === 'codex' ? 'codex' : 'claude'
    const enabled = input.enabled === true
    enablePluginForAgent(center, id, agent, enabled)
    record(enabled ? 'plugin.enable' : 'plugin.disable', id)
    return center.repository.findPlugin(id, agent)
  })

  ipcMain.handle(IPC.capabilityPluginRemove, async (_event, value: unknown) => {
    const input = assertRecord(value, '插件卸载参数')
    const id = assertLongId(input.id, '插件 id')
    const agent = input.agent === 'codex' ? 'codex' : 'claude'
    if (agent === 'codex') {
      const { name, market } = splitPluginId(id)
      await sources.removeCodexPlugin(name, market).catch(() => undefined)
      removeSyncedSkills(center.codexHome, id)
    }
    center.repository.removePlugin(id, agent)
    center.toolSurface.remove(agent, `skill:${id}`)
    record('plugin.remove', `${agent} · ${id}`)
  })
}
