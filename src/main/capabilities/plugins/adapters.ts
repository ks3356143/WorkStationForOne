import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PluginAgent } from '../../../shared/ipc'
import type { StoredPlugin } from '../../db/capabilities'
import { readCodexPluginEnabled } from './codex-config'

export interface AdapterPlugin {
  /** 插件 id，Codex 侧形如 `name@market` */
  id: string
  name: string
  market: string
  version: string
  /** 实际安装目录；拿不到时为 null */
  installPath: string | null
  enabled: boolean
}

/**
 * 从 Codex 的私有 home 读已装插件：
 * config.toml 给启停状态，plugins/cache/<market>/<plugin>/<version> 给版本与路径。
 */
export function listCodexInstalled(codexHome: string): AdapterPlugin[] {
  const configFile = join(codexHome, 'config.toml')
  const config = existsSync(configFile) ? readFileSync(configFile, 'utf8') : ''
  const cacheRoot = join(codexHome, 'plugins', 'cache')
  if (!existsSync(cacheRoot)) return []

  const result: AdapterPlugin[] = []
  for (const market of safeDirs(cacheRoot)) {
    const marketDir = join(cacheRoot, market)
    for (const plugin of safeDirs(marketDir)) {
      const versions = safeDirs(join(marketDir, plugin))
      const version = pickVersion(versions)
      const selector = `${plugin}@${market}`
      const state = readCodexPluginEnabled(config, selector)
      result.push({
        id: selector,
        name: plugin,
        market,
        version,
        installPath: version ? join(marketDir, plugin, version) : null,
        enabled: state.enabled
      })
    }
  }
  return result
}

/** 版本目录按名称倒序，取最新一个；无法比较时退回原顺序首个。 */
function pickVersion(versions: string[]): string {
  if (versions.length <= 1) return versions[0] ?? ''
  return [...versions].sort((a, b) => compareVersion(b, a))[0]
}

export function compareVersion(a: string, b: string): number {
  const left = a.split(/[.-]/).map((part) => Number.parseInt(part, 10))
  const right = b.split(/[.-]/).map((part) => Number.parseInt(part, 10))
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const l = Number.isFinite(left[index]) ? left[index] : 0
    const r = Number.isFinite(right[index]) ? right[index] : 0
    if (l !== r) return l - r
  }
  return 0
}

function safeDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

/** 把数据库记录与磁盘现状合并：磁盘上有但库里没有的补录，反之标为来源消失。 */
export function reconcile(
  stored: StoredPlugin[],
  installed: AdapterPlugin[],
  agent: PluginAgent
): Array<AdapterPlugin & { trusted: boolean; inDb: boolean; missingOnDisk: boolean }> {
  const byId = new Map(installed.map((plugin) => [plugin.id, plugin]))
  const merged: Array<AdapterPlugin & { trusted: boolean; inDb: boolean; missingOnDisk: boolean }> =
    []

  for (const plugin of stored) {
    if (plugin.agent !== agent) continue
    const live = byId.get(plugin.id)
    merged.push({
      id: plugin.id,
      name: plugin.name,
      market: plugin.marketplace,
      version: live?.version || plugin.version,
      installPath: live?.installPath ?? plugin.installPath,
      enabled: live ? live.enabled : plugin.enabled,
      trusted: plugin.trusted,
      inDb: true,
      missingOnDisk: !live
    })
    byId.delete(plugin.id)
  }

  for (const plugin of byId.values()) {
    merged.push({ ...plugin, trusted: false, inDb: false, missingOnDisk: false })
  }
  return merged
}
