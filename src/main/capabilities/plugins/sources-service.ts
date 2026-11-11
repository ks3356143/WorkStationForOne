import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { resolveCodexCli, resolvePluginCli, type AgentCli } from '../../agent/cli'
import type { CapabilityRepository, PluginSourceInput } from '../../db/capabilities'
import type { PluginAgent, PluginSourceRecord } from '../../../shared/ipc'
import {
  assertSourceName,
  cloneSource,
  isLocalPath,
  readMarketplace,
  refreshSource,
  resolvePluginSource,
  sourceSlug,
  validateSourceUrl,
  type MarketplacePlugin
} from './sources'

const CLI_TIMEOUT = 180_000

/** 把 GitHub HTTPS / SSH 地址转成 `owner/repo`；非 GitHub 返回 null。 */
export function githubSlug(url?: string): string | null {
  if (!url) return null
  const https = /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url)
  if (https) return `${https[1]}/${https[2]}`
  const ssh = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/i.exec(url)
  if (ssh) return `${ssh[1]}/${ssh[2]}`
  return null
}

export interface PluginSourceServiceOptions {
  repository: CapabilityRepository
  /** 应用数据根目录；源目录落在 `<root>/agent/plugin-sources` */
  appDataDir: string
  /** 两个 Agent 的私有配置目录 */
  claudeConfigDir: string
  codexHome: string
  claudeCli?: AgentCli | null
  codexCli?: AgentCli | null
}

export interface SourceRefreshResult {
  source: PluginSourceRecord
  plugins: MarketplacePlugin[]
}

/**
 * 插件源管理：Git 克隆、刷新，以及向两个 Agent 的私有环境注册市场。
 * 只操作应用私有目录，不读写 `~/.claude` 与 `~/.codex`。
 */
export class PluginSourceService {
  private readonly sourceRoot: string

  constructor(private readonly options: PluginSourceServiceOptions) {
    this.sourceRoot = join(options.appDataDir, 'agent', 'plugin-sources')
    mkdirSync(this.sourceRoot, { recursive: true })
  }

  list(): PluginSourceRecord[] {
    return this.options.repository.listSources()
  }

  /** 列出某源当前可见的插件；读不到时返回空数组并附带错误。 */
  pluginsOf(source: PluginSourceRecord): { plugins: MarketplacePlugin[]; error: string } {
    try {
      return { plugins: readMarketplace(source.root).plugins, error: '' }
    } catch (error) {
      return { plugins: [], error: error instanceof Error ? error.message : '源不可读' }
    }
  }

  async add(input: {
    name: string
    url: string
    ref?: string
    kind?: 'git' | 'official'
  }): Promise<PluginSourceRecord> {
    const name = assertSourceName(input.name)
    const invalid = validateSourceUrl(input.url)
    if (invalid) throw new Error(invalid)
    const ref = (input.ref ?? '').trim()
    const url = input.url.trim()
    const root = join(this.sourceRoot, sourceSlug(name))
    if (existsSync(root)) {
      // slug 会小写/归一/截断，不同名称可能落到同一目录；只要有任何记录引用它就是有效快照，
      // 不能当半成品删掉（否则两个源共用一个 root，失败时还会连带删掉原源的目录）。
      if (this.options.repository.listSources().some((source) => source.root === root)) {
        throw new Error('源目录已存在，请更换名称或先移除旧源')
      }
      this.removeDir(root, '上次添加留下的目录无法清理，请稍后重试')
    }

    const record: PluginSourceInput = {
      id: `src-${sourceSlug(name)}-${Date.now().toString(36)}`,
      name,
      kind: input.kind ?? 'git',
      url,
      ref,
      // 本地目录源直接引用用户给的路径；Git 源才落到应用私有目录
      root: isLocalPath(url) ? url : root
    }

    try {
      if (!isLocalPath(url)) {
        await cloneSource(url, root, ref)
      } else if (!existsSync(url)) {
        throw new Error('本地源目录不存在')
      }
      const manifest = readMarketplace(record.root)
      const saved = this.options.repository.createSource(record)
      // 官方市场名被 Claude 保留，只能用 GitHub 源注册；Git 源一律优先传 owner/repo
      const registrationErrors = await this.register(manifest.name, record.root, url)
      this.options.repository.markSourceSynced(
        saved.id,
        registrationErrors.join('；'),
        manifest.plugins.length
      )
      return this.options.repository.findSource(saved.id) ?? saved
    } catch (error) {
      // 清理失败不能盖掉真正的原因，残留目录留给下次添加前清理
      if (!isLocalPath(url)) this.removeDir(root, null)
      throw error
    }
  }

  async refresh(id: string): Promise<SourceRefreshResult> {
    const source = this.options.repository.findSource(id)
    if (!source) throw new Error('插件源不存在')
    try {
      if (!isLocalPath(source.url)) await refreshSource(source.root, source.ref)
      const manifest = readMarketplace(source.root)
      const registrationErrors = await this.register(manifest.name, source.root)
      this.options.repository.markSourceSynced(
        id,
        registrationErrors.join('；'),
        manifest.plugins.length
      )
      return {
        source: this.options.repository.findSource(id) ?? source,
        plugins: manifest.plugins
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '刷新失败'
      this.options.repository.markSourceSynced(id, message, source.pluginCount)
      throw new Error(message)
    }
  }

  async remove(id: string): Promise<void> {
    const source = this.options.repository.findSource(id)
    if (!source) return
    if (source.kind === 'official') throw new Error('官方源不能移除')
    // 市场按清单里的 name 注册，用源名称注销会留下残留条目
    let marketName = source.name
    try {
      marketName = readMarketplace(source.root).name
    } catch {
      // 目录已不可读时退回源名称
    }
    await this.unregister(marketName).catch(() => {
      // CLI 侧没有这个市场时忽略
    })
    // 本地目录源只解除引用，不删用户的目录
    if (!isLocalPath(source.url)) this.removeDir(source.root, '源目录无法删除，请稍后重试')
    this.options.repository.removeSource(id)
  }

  resolvePluginRoot(source: PluginSourceRecord, plugin: MarketplacePlugin): string {
    return resolvePluginSource(source.root, plugin.source)
  }

  /**
   * 向两个 Agent 注册市场。
   * Claude 对 `claude-plugins-official` 这类名字有保留限制，只接受 anthropics 组织的
   * GitHub 源；因此 GitHub 源优先传 `owner/repo`，本地目录源才传绝对路径。
   * 返回注册失败原因（不抛出），由调用方写进源的 lastError。
   */
  async register(_marketName: string, root: string, url?: string): Promise<string[]> {
    const source = githubSlug(url) ?? root
    const results = await Promise.allSettled([
      this.runCli('claude', ['plugin', 'marketplace', 'add', source]),
      this.runCli('codex', ['plugin', 'marketplace', 'add', root])
    ])
    return results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) =>
        result.reason instanceof Error ? result.reason.message : String(result.reason)
      )
  }

  async unregister(marketName: string): Promise<void> {
    await Promise.all([
      this.runCli('claude', ['plugin', 'marketplace', 'remove', marketName]).catch(() => undefined),
      this.runCli('codex', ['plugin', 'marketplace', 'remove', marketName]).catch(() => undefined)
    ])
  }

  /** 卸载 Codex 插件；插件不在时静默忽略。 */
  async removeCodexPlugin(plugin: string, market: string): Promise<void> {
    await this.runCli('codex', ['plugin', 'remove', `${plugin}@${market}`])
  }

  /** 刷新所有 Codex 市场快照：插件新版本要先进快照才能被重装。 */
  async upgradeCodexMarketplaces(): Promise<void> {
    await this.runCli('codex', ['plugin', 'marketplace', 'upgrade'])
  }

  /**
   * Codex 没有 `plugin update`，更新等同于「刷新快照后重装」。
   * 先删再装，避免旧版本目录残留两份缓存。
   */
  async reinstallCodexPlugin(plugin: string, market: string): Promise<void> {
    await this.removeCodexPlugin(plugin, market).catch(() => undefined)
    await this.runCli('codex', ['plugin', 'add', `${plugin}@${market}`])
  }

  /** Windows 上刚结束的 git / CLI 进程可能仍持有句柄；删不掉时改名挪走，原名即可复用。 */
  private removeDir(dir: string, note: string | null): void {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
      return
    } catch {
      // 落到改名兜底
    }
    try {
      const stale = `${dir}.deleted-${Date.now().toString(36)}`
      renameSync(dir, stale)
      try {
        rmSync(stale, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
      } catch {
        // 留给系统清理占位目录，不影响重新克隆
      }
      return
    } catch {
      // 改名也失败：交给调用方
    }
    if (note) throw new Error(note)
  }

  private runCli(agent: PluginAgent, args: string[]): Promise<string> {
    const cli =
      agent === 'claude'
        ? (this.options.claudeCli ?? resolvePluginCli())
        : (this.options.codexCli ?? resolveCodexCli())
    if (!cli) return Promise.reject(new Error(`未找到 ${agent} CLI`))
    // Codex 直接拒绝不存在的 CODEX_HOME，Claude 的配置目录同理；注册前先建好
    const configDir = agent === 'claude' ? this.options.claudeConfigDir : this.options.codexHome
    mkdirSync(configDir, { recursive: true })
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NO_COLOR: '1',
      ...(cli.viaNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      ...(agent === 'claude'
        ? { CLAUDE_CONFIG_DIR: this.options.claudeConfigDir }
        : { CODEX_HOME: this.options.codexHome })
    }
    return new Promise((resolvePromise, reject) => {
      const child = spawn(cli.bin, [...cli.prefixArgs, ...args], {
        cwd: this.options.appDataDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true
      })
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error(`${agent} CLI 超时`))
      }, CLI_TIMEOUT)
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        if (stdout.length < 64_000) stdout += chunk
      })
      child.stderr.on('data', (chunk: string) => {
        if (stderr.length < 8_000) stderr += chunk
      })
      child.on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        if (code === 0) resolvePromise(stdout)
        else reject(new Error(stderr.trim().split(/\r?\n/).at(-1) || `${agent} CLI 退出码 ${code}`))
      })
    })
  }
}
