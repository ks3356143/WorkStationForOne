import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { PluginAgent } from '../../../shared/ipc'
import type { CapabilityRepository } from '../../db/capabilities'
import { scanLocal, type LocalPlugin, type LocalScanResult } from './local-scan'

export interface ImportSelection {
  agent: PluginAgent
  /** 要导入的市场名；只导入插件时可留空 */
  markets: string[]
  /** 要导入的插件 id（`name@market`） */
  plugins: string[]
}

export interface ImportOutcome {
  importedMarkets: string[]
  importedPlugins: string[]
  skipped: Array<{ id: string; reason: string }>
}

export interface ImportDeps {
  repository: CapabilityRepository
  /** 目标根目录：Claude 插件落在 <agentDir>/claude-plugins，Codex 落在 codex-home */
  agentDir: string
  codexHome: string
  /** 把某个市场注册进应用私有环境（源服务提供） */
  registerMarket: (market: string, root: string) => Promise<void>
  /** 复制插件目录后写入索引；由调用方决定具体落点 */
  installFromDirectory: (
    agent: PluginAgent,
    source: string,
    meta: { id: string; name: string; market: string; version: string }
  ) => void
}

/** 只读扫描本机，供界面展示与勾选。 */
export function scanForImport(root?: string): LocalScanResult[] {
  return [scanLocal('claude', root), scanLocal('codex', root)]
}

/**
 * 导入：把本机已装配置复制进应用私有目录。
 * 只读扫描结果，不回写 `~/.claude` 与 `~/.codex`。
 */
export async function importLocal(
  selection: ImportSelection,
  scan: LocalScanResult,
  deps: ImportDeps
): Promise<ImportOutcome> {
  const outcome: ImportOutcome = { importedMarkets: [], importedPlugins: [], skipped: [] }

  for (const market of selection.markets) {
    const found = scan.marketplaces.find((item) => item.name === market)
    if (!found) {
      outcome.skipped.push({ id: market, reason: '本机没有这个市场' })
      continue
    }
    try {
      await deps.registerMarket(market, found.source)
      outcome.importedMarkets.push(market)
    } catch (error) {
      outcome.skipped.push({
        id: market,
        reason: error instanceof Error ? error.message : '注册失败'
      })
    }
  }

  for (const id of selection.plugins) {
    const plugin = scan.plugins.find((item) => item.id === id)
    if (!plugin) {
      outcome.skipped.push({ id, reason: '本机没有这个插件' })
      continue
    }
    if (deps.repository.findPlugin(id, selection.agent)) {
      outcome.skipped.push({ id, reason: '已经导入过' })
      continue
    }
    if (!plugin.installPath || !existsSync(plugin.installPath)) {
      outcome.skipped.push({ id, reason: '本机安装目录不存在' })
      continue
    }
    try {
      deps.installFromDirectory(selection.agent, plugin.installPath, {
        id: plugin.id,
        name: plugin.name,
        market: plugin.market,
        version: plugin.version
      })
      outcome.importedPlugins.push(id)
    } catch (error) {
      outcome.skipped.push({
        id,
        reason: error instanceof Error ? error.message : '复制失败'
      })
    }
  }

  return outcome
}

/**
 * 离线导入的落点：把本机插件目录快照复制到应用私有位置。
 * 返回复制后的目录，供索引记录。
 */
export function copyPluginSnapshot(
  agent: PluginAgent,
  source: string,
  target: { agentDir: string; codexHome: string },
  plugin: LocalPlugin
): string {
  const base =
    agent === 'claude'
      ? join(target.agentDir, 'claude-plugins', 'imported')
      : join(target.codexHome, 'plugins', 'imported')
  const dir = join(base, plugin.market, plugin.name, plugin.version || 'local')
  mkdirSync(dir, { recursive: true })
  cpSync(source, dir, { recursive: true, force: true })
  return dir
}

/** 列出目录下的子目录名，导入面板用来判断是否还有可导入内容。 */
export function subdirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}
