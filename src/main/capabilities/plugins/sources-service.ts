import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
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

const CLI_TIMEOUT = 90_000

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
    if (existsSync(root)) throw new Error('源目录已存在，请更换名称或先移除旧源')

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
      await this.register(manifest.name, record.root).catch(() => {
        // 注册失败不影响源入库，刷新时还能再试
      })
      this.options.repository.markSourceSynced(saved.id, '', manifest.plugins.length)
      return this.options.repository.findSource(saved.id) ?? saved
    } catch (error) {
      if (!isLocalPath(url)) rmSync(root, { recursive: true, force: true })
      throw error
    }
  }

  async refresh(id: string): Promise<SourceRefreshResult> {
    const source = this.options.repository.findSource(id)
    if (!source) throw new Error('插件源不存在')
    try {
      if (!isLocalPath(source.url)) await refreshSource(source.root, source.ref)
      const manifest = readMarketplace(source.root)
      await this.register(manifest.name, source.root)
      this.options.repository.markSourceSynced(id, '', manifest.plugins.length)
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
    await this.unregister(source.name).catch(() => {
      // CLI 侧没有这个市场时忽略
    })
    // 本地目录源只解除引用，不删用户的目录
    if (!isLocalPath(source.url)) rmSync(source.root, { recursive: true, force: true })
    this.options.repository.removeSource(id)
  }

  resolvePluginRoot(source: PluginSourceRecord, plugin: MarketplacePlugin): string {
    return resolvePluginSource(source.root, plugin.source)
  }

  /** 向 Claude 与 Codex 各自注册同一个本地市场目录。 */
  async register(_marketName: string, root: string): Promise<void> {
    await Promise.all([
      this.runCli('claude', ['plugin', 'marketplace', 'add', root]).catch(() => undefined),
      this.runCli('codex', ['plugin', 'marketplace', 'add', root]).catch(() => undefined)
    ])
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

  private runCli(agent: PluginAgent, args: string[]): Promise<string> {
    const cli =
      agent === 'claude'
        ? (this.options.claudeCli ?? resolvePluginCli())
        : (this.options.codexCli ?? resolveCodexCli())
    if (!cli) return Promise.reject(new Error(`未找到 ${agent} CLI`))
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
