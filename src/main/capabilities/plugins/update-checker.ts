import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PluginAgent } from '../../../shared/ipc'
import type { CapabilityRepository } from '../../db/capabilities'
import type { McpServerService } from '../mcp-servers'
import type { PluginSourceService } from './sources-service'
import { listCodexInstalled } from './adapters'
import { resolvePluginSource, type MarketplacePlugin } from './sources'
import { collectCandidates, type UpdateCandidate } from '../updates'

export interface UpdateCheckDeps {
  repository: CapabilityRepository
  sources: PluginSourceService
  mcp: McpServerService
  /** 已安装插件所在的两个 Agent 私有目录 */
  codexHome: string
  claudeInstallRoot: (pluginId: string) => string | null
  /** 检查完成后的通知；由主进程推给渲染层 */
  onAvailable: (candidates: UpdateCandidate[]) => void
  log?: (message: string) => void
}

const STARTUP_DELAY = 6_000

/**
 * 启动后延迟执行一次更新检查。
 * 离线、超时、源不可达都静默失败：只写日志，不弹窗打扰。
 */
export class UpdateChecker {
  private running = false
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly deps: UpdateCheckDeps) {}

  scheduleStartup(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.check().catch((error: unknown) => {
        this.deps.log?.(
          `[updates] 检查失败：${error instanceof Error ? error.message : '未知错误'}`
        )
      })
    }, STARTUP_DELAY)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** 并发检查所有源与 MCP；同一时刻只跑一次。 */
  async check(): Promise<UpdateCandidate[]> {
    if (this.running) return []
    this.running = true
    try {
      const plugins = await this.collectPluginVersions()
      const mcp = await this.collectMcpVersions()
      const candidates = collectCandidates(plugins, mcp)
      if (candidates.length > 0) this.deps.onAvailable(candidates)
      return candidates
    } finally {
      this.running = false
    }
  }

  private async collectPluginVersions(): Promise<Parameters<typeof collectCandidates>[0]> {
    const result: Parameters<typeof collectCandidates>[0] = []
    const sources = this.deps.repository.listSources()

    for (const source of sources) {
      // 源刷新失败不影响其它源；错误已写进 last_error
      let manifest: MarketplacePlugin[]
      try {
        manifest = (await this.deps.sources.refresh(source.id)).plugins
      } catch {
        continue
      }
      const byName = new Map(manifest.map((plugin) => [plugin.name, plugin]))
      for (const agent of ['claude', 'codex'] as PluginAgent[]) {
        const installed = this.installedFor(agent)
        for (const plugin of installed) {
          const latest = byName.get(plugin.name)
          if (!latest) continue
          // 清单里没有版本号时退回已装版本，collectCandidates 会跳过
          const latestVersion = versionFromManifest(source.root, latest.source)
          result.push({
            id: plugin.id,
            name: plugin.name,
            version: plugin.version,
            latestVersion,
            agent,
            sourceName: source.name
          })
        }
      }
    }
    return result
  }

  private installedFor(agent: PluginAgent): Array<{ id: string; name: string; version: string }> {
    if (agent === 'codex') {
      return listCodexInstalled(this.deps.codexHome).map((plugin) => ({
        id: plugin.id,
        name: plugin.name,
        version: plugin.version
      }))
    }
    return this.deps.repository
      .listPlugins('claude')
      .map((plugin) => ({ id: plugin.id, name: plugin.name, version: plugin.version }))
  }

  private async collectMcpVersions(): Promise<Parameters<typeof collectCandidates>[1]> {
    try {
      const list = await this.deps.mcp.checkUpdates()
      return list.map((item) => ({
        id: item.id,
        name: item.name,
        currentVersion: item.currentVersion,
        latestVersion: item.latestVersion
      }))
    } catch {
      return []
    }
  }
}

/**
 * 从源里的插件目录读版本号：优先 `.claude-plugin/plugin.json`，退回根目录
 * 的 `plugin.json`。读不到返回空串，候选收集会按「无更新」跳过。
 */
function versionFromManifest(root: string, pluginSource: string): string {
  const dir = resolvePluginSource(root, pluginSource)
  for (const file of [join(dir, '.claude-plugin', 'plugin.json'), join(dir, 'plugin.json')]) {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
      if (typeof parsed.version === 'string' && parsed.version.trim()) {
        return parsed.version.trim()
      }
    } catch {
      // 换下一个候选文件
    }
  }
  return ''
}
