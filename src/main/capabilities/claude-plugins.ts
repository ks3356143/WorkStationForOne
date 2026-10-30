import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import type { Dirent } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'
import type { AgentCli } from '../agent/cli'
import { resolveCommand, resolvePluginCli } from '../agent/cli'
import type { CapabilityRepository, StoredPlugin } from '../db/capabilities'
import type {
  SkillInspection,
  SkillMarketEntry,
  SkillMarketSnapshot,
  SkillRecord
} from '../../shared/ipc'

// 用 HTTPS + sparse，避免依赖用户的 SSH 配置；完整 clone 在本机网络下会超时。
const OFFICIAL_MARKETPLACE = 'https://github.com/anthropics/claude-plugins-official'
// Claude CLI 不允许本地目录使用官方保留名；应用镜像改用私有名，界面仍标成 Claude 官方。
const MARKET_NAME = 'wsfo-official'
const MARKET_TTL = 6 * 60 * 60 * 1000
const CLI_TIMEOUT = 60_000
const MARKET_ADD_TIMEOUT = 120_000
const CLONE_TIMEOUT = 180_000
const MAX_OUTPUT = 2 * 1024 * 1024

interface PluginListEntry {
  id?: string
  pluginId?: string
  name?: string
  description?: string
  version?: string
  installPath?: string
  marketplaceName?: string
}

interface MarketCache {
  fetchedAt: number
  entries: SkillMarketEntry[]
}

interface InstallInfo {
  id: string
  name: string
  description: string
  version: string
  marketplace: string
  installPath: string
  components: string[]
  hasHooks: boolean
  hasMcp: boolean
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function pluginEntries(value: unknown): PluginListEntry[] {
  if (Array.isArray(value)) return value.map((item) => asRecord(item) as PluginListEntry)
  const record = asRecord(value)
  if (Array.isArray(record.plugins)) {
    return record.plugins.map((item) => asRecord(item) as PluginListEntry)
  }
  return []
}

/**
 * Claude CLI 的 --json 输出可能是多行 pretty JSON，也可能前面带提示。
 * 依次尝试整体、首个对象 / 数组、最后一行，避免只解析末行 `}`。
 */
export function parsePluginJson(stdout: string): unknown {
  const text = stdout.trim()
  if (!text) return null
  const attempts = [text]
  const objectStart = text.indexOf('{')
  const objectEnd = text.lastIndexOf('}')
  const arrayStart = text.indexOf('[')
  const arrayEnd = text.lastIndexOf(']')
  const objectSlice =
    objectStart >= 0 && objectEnd > objectStart ? text.slice(objectStart, objectEnd + 1) : ''
  const arraySlice =
    arrayStart >= 0 && arrayEnd > arrayStart ? text.slice(arrayStart, arrayEnd + 1) : ''
  // 取最先出现的顶层结构，避免把数组里的对象误当成整个结果
  if (arraySlice && (!objectSlice || arrayStart < objectStart)) attempts.push(arraySlice)
  if (objectSlice) attempts.push(objectSlice)
  if (arraySlice && objectSlice && arrayStart > objectStart) attempts.push(arraySlice)
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const lastLine = lines.at(-1)
  if (lastLine) attempts.push(lastLine)
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt)
    } catch {
      // 尝试下一种切法
    }
  }
  return null
}

function marketplaceFromId(id: string): string {
  const at = id.lastIndexOf('@')
  return at >= 0 ? id.slice(at + 1) : ''
}

function pluginNameFromId(id: string): string {
  const at = id.lastIndexOf('@')
  return at >= 0 ? id.slice(0, at) : id
}

function inspectPlugin(installPath: string): {
  components: string[]
  hasHooks: boolean
  hasMcp: boolean
} {
  const components: string[] = []
  const hasDir = (name: string) => {
    try {
      return existsSync(join(installPath, name))
    } catch {
      return false
    }
  }
  if (hasDir('skills')) components.push('skills')
  if (hasDir('commands')) components.push('commands')
  if (hasDir('agents')) components.push('agents')
  if (hasDir('hooks')) components.push('hooks')
  const hasHooks =
    hasDir('hooks') ||
    existsSync(join(installPath, 'hooks', 'hooks.json')) ||
    existsSync(join(installPath, 'hooks.json'))
  const hasMcp =
    existsSync(join(installPath, '.mcp.json')) ||
    existsSync(join(installPath, 'mcp.json')) ||
    existsSync(join(installPath, '.mcp.jsonc'))
  if (hasMcp) components.push('mcp')
  return { components, hasHooks, hasMcp }
}

function toRecord(plugin: StoredPlugin): SkillRecord {
  return {
    id: plugin.id,
    name: plugin.name,
    description: plugin.description,
    version: plugin.version,
    marketplace: plugin.marketplace,
    enabled: plugin.enabled,
    trusted: plugin.trusted,
    components: plugin.components,
    hasHooks: plugin.hasHooks,
    hasMcp: plugin.hasMcp,
    installedAt: plugin.installedAt,
    updatedAt: plugin.updatedAt
  }
}

/**
 * 应用私有的 Claude 插件库：用隔离的 CLAUDE_CONFIG_DIR 跑 Claude CLI 的
 * marketplace / install / update / uninstall，再把插件目录通过 --plugin-dir
 * 只加载到本应用启动的 Claude 会话。绝不写 ~/.claude。
 */
export class ClaudePluginService {
  private readonly configDir: string
  private readonly cachePath: string
  private readonly marketSourceDir: string
  private marketPromise: Promise<SkillMarketEntry[]> | null = null
  private cliPromise: AgentCli | null | undefined

  constructor(
    private readonly repository: CapabilityRepository,
    appDataDir: string,
    private readonly cliOverride?: AgentCli | null
  ) {
    const root = join(appDataDir, 'agent', 'claude-plugins')
    this.configDir = join(root, 'config')
    this.cachePath = join(root, 'market.json')
    this.marketSourceDir = join(root, 'market-src')
    mkdirSync(this.configDir, { recursive: true })
  }

  list(): SkillRecord[] {
    return this.repository.listPlugins().map(toRecord)
  }

  /**
   * 本地导入只复制到应用私有目录，不修改源目录。
   * 支持完整插件（.claude-plugin/plugin.json）、裸 SKILL.md 或 skills/ 目录。
   */
  importLocal(sourcePath: string): SkillRecord {
    const source = resolve(sourcePath)
    if (!existsSync(source) || !statSync(source).isDirectory()) {
      throw new Error('请选择一个包含 SKILL.md 或插件清单的目录')
    }
    const rawName = basename(source) || 'local-skill'
    const slug =
      rawName
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 32) || 'local-skill'
    const id = `local:${slug}-${randomUUID().slice(0, 8)}`
    const targetRoot = join(this.configDir, '..', 'local')
    const target = join(targetRoot, id.replace(/[^A-Za-z0-9_-]/g, '-'))
    mkdirSync(targetRoot, { recursive: true })

    const manifestPath = join(target, '.claude-plugin', 'plugin.json')
    const manifest = {
      name: `wsfo-${slug}-${id.slice(-8)}`,
      version: 'local',
      description: `Imported from ${rawName}`
    }
    try {
      if (existsSync(join(source, '.claude-plugin', 'plugin.json'))) {
        cpSync(source, target, { recursive: true })
      } else if (existsSync(join(source, 'SKILL.md'))) {
        mkdirSync(join(target, 'skills', slug), { recursive: true })
        cpSync(source, join(target, 'skills', slug), { recursive: true })
        mkdirSync(join(target, '.claude-plugin'), { recursive: true })
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
      } else if (existsSync(join(source, 'skills'))) {
        cpSync(join(source, 'skills'), join(target, 'skills'), { recursive: true })
        mkdirSync(join(target, '.claude-plugin'), { recursive: true })
        writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
      } else {
        throw new Error('找不到 .claude-plugin/plugin.json、SKILL.md 或 skills 目录')
      }
      if (!existsSync(manifestPath)) {
        throw new Error('插件缺少 .claude-plugin/plugin.json')
      }
    } catch (error) {
      rmSync(target, { recursive: true, force: true })
      throw error
    }

    const inventory = inspectPlugin(target)
    const saved = this.repository.upsertPlugin({
      id,
      name: rawName,
      description: `本地导入 · ${rawName}`,
      version: 'local',
      marketplace: 'local',
      installPath: target,
      components: inventory.components,
      hasHooks: inventory.hasHooks,
      hasMcp: inventory.hasMcp,
      enabled: false,
      trusted: !(inventory.hasHooks || inventory.hasMcp)
    })
    return toRecord(saved)
  }

  inspectSkill(pluginId: string): SkillInspection {
    const folder = this.folderFor(pluginId)
    const files: string[] = []
    const walk = (dir: string, depth: number) => {
      if (depth > 4 || files.length >= 200) return
      let entries: Dirent[]
      try {
        entries = readdirSync(dir, { withFileTypes: true, encoding: 'utf8' })
      } catch {
        return
      }
      for (const entry of entries) {
        if (files.length >= 200) return
        if (entry.name === '.git' || entry.name === 'node_modules') continue
        if (entry.isSymbolicLink()) continue
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full, depth + 1)
        else files.push(relative(folder, full).replaceAll('\\', '/'))
      }
    }
    walk(folder, 0)
    files.sort()
    const docs: { path: string; content: string }[] = []
    for (const file of files) {
      if (basename(file).toLowerCase() !== 'skill.md') continue
      try {
        const full = join(folder, file)
        if (statSync(full).size > 64 * 1024) continue
        docs.push({ path: file, content: readFileSync(full, 'utf8') })
      } catch {
        // 单个文件读取失败不影响其它文件
      }
      if (docs.length >= 10) break
    }
    return { files, docs }
  }

  /** 打开前再次校验路径仍位于应用私有插件根目录。 */
  folderFor(pluginId: string): string {
    const plugin = this.repository.findPlugin(pluginId)
    if (!plugin) throw new Error('插件未安装')
    const root = resolve(this.configDir, '..')
    const target = resolve(plugin.installPath)
    const rel = relative(root, target)
    if (rel.startsWith('..') || rel.includes('..')) throw new Error('插件目录不在应用私有目录内')
    if (!existsSync(target) || !statSync(target).isDirectory()) throw new Error('插件目录不存在')
    return target
  }

  async market(force = false): Promise<SkillMarketSnapshot> {
    const cached = this.readCache()
    if (!force && cached && Date.now() - cached.fetchedAt < MARKET_TTL) {
      return {
        entries: this.withInstalled(cached.entries),
        fetchedAt: cached.fetchedAt,
        stale: false
      }
    }
    if (force) {
      await this.refreshMarketSource().catch((error: unknown) => {
        console.error('[capability] 刷新 Claude 市场源失败，继续使用本地缓存', error)
      })
    }
    try {
      const entries = await this.fetchMarketOnce()
      const fetchedAt = Date.now()
      this.writeCache({ fetchedAt, entries })
      return { entries: this.withInstalled(entries), fetchedAt, stale: false }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Claude 市场读取失败'
      if (cached) {
        return {
          entries: this.withInstalled(cached.entries),
          fetchedAt: cached.fetchedAt,
          stale: true,
          error: message
        }
      }
      throw error
    }
  }

  async install(pluginId: string): Promise<SkillRecord> {
    await this.run(['plugin', 'install', pluginId, '--scope', 'user', '--json'])
    const installed = await this.refreshInstalled(pluginId)
    if (!installed) throw new Error('插件安装后没有出现在应用私有目录中')
    return toRecord(
      this.repository.upsertPlugin({
        ...installed,
        enabled: false,
        trusted: !(installed.hasHooks || installed.hasMcp)
      })
    )
  }

  async update(pluginId: string): Promise<SkillRecord> {
    const existing = this.repository.findPlugin(pluginId)
    if (!existing) throw new Error('插件未安装')
    await this.run(['plugin', 'update', pluginId, '--json'])
    const refreshed = await this.refreshInstalled(pluginId)
    if (!refreshed) throw new Error('插件更新后没有找到安装目录')
    const risky = refreshed.hasHooks || refreshed.hasMcp
    return toRecord(
      this.repository.upsertPlugin({
        ...refreshed,
        // 更新后内容变了：一旦带 hooks / MCP，就停用并要求重新信任
        enabled: risky ? false : existing.enabled,
        trusted: risky ? false : existing.trusted
      })
    )
  }

  async remove(pluginId: string): Promise<void> {
    const plugin = this.repository.findPlugin(pluginId)
    if (plugin?.marketplace === 'local' || pluginId.startsWith('local:')) {
      if (plugin) {
        try {
          rmSync(plugin.installPath, { recursive: true, force: true })
        } catch {
          // 目录可能已被手动删除
        }
      }
      this.repository.removePlugin(pluginId)
      return
    }
    await this.run(['plugin', 'uninstall', pluginId, '--scope', 'user', '--json'])
    this.repository.removePlugin(pluginId)
  }

  setEnabled(pluginId: string, enabled: boolean, trust = false): SkillRecord {
    const plugin = this.repository.findPlugin(pluginId)
    if (!plugin) throw new Error('插件未安装')
    if (enabled && (plugin.hasHooks || plugin.hasMcp) && !plugin.trusted && !trust) {
      throw new Error('这个插件包含 hooks 或 MCP，需要先确认信任')
    }
    const updated = this.repository.setPluginEnabled(
      pluginId,
      enabled,
      enabled && (plugin.hasHooks || plugin.hasMcp || trust) ? true : undefined
    )
    if (!updated) throw new Error('插件状态保存失败')
    return toRecord(updated)
  }

  /** 启动 Claude 前取启用插件的安装目录；只返回应用私有目录内的路径。 */
  pluginDirs(): string[] {
    // 市场插件在 config/plugins/cache 下，本地导入在 claude-plugins/local 下
    const root = resolve(this.configDir, '..')
    return this.repository
      .listPlugins()
      .filter((plugin) => plugin.enabled)
      .map((plugin) => resolve(plugin.installPath))
      .filter((path) => {
        const rel = relative(root, path)
        if (rel !== '' && (rel.startsWith('..') || rel.includes('..'))) return false
        try {
          return statSync(path).isDirectory()
        } catch {
          return false
        }
      })
  }

  private fetchMarketOnce(): Promise<SkillMarketEntry[]> {
    if (!this.marketPromise) {
      this.marketPromise = this.fetchMarket().finally(() => {
        this.marketPromise = null
      })
    }
    return this.marketPromise
  }

  private async fetchMarket(): Promise<SkillMarketEntry[]> {
    const markets = await this.run(['plugin', 'marketplace', 'list', '--json'])
    const list = parsePluginJson(markets)
    const configured = Array.isArray(list)
      ? list.map((item) => text(asRecord(item).name)).filter(Boolean)
      : []
    if (!configured.includes(MARKET_NAME) && !configured.includes('claude-plugins-official')) {
      const localSource = await this.ensureMarketSource()
      await this.run(
        [
          'plugin',
          'marketplace',
          'add',
          localSource ?? OFFICIAL_MARKETPLACE,
          '--scope',
          'user',
          ...(localSource ? [] : ['--sparse', '.claude-plugin', 'plugins']),
          '--json'
        ],
        MARKET_ADD_TIMEOUT
      )
    }
    const available = await this.run(['plugin', 'list', '--available', '--json'])
    const parsed = asRecord(parsePluginJson(available))
    const items = Array.isArray(parsed.available) ? parsed.available : []
    return items.map((item) => {
      const entry = asRecord(item)
      const pluginId = text(entry.pluginId) || text(entry.id)
      return {
        pluginId,
        name: text(entry.name) || pluginNameFromId(pluginId),
        description: text(entry.description),
        marketplace: text(entry.marketplaceName) || marketplaceFromId(pluginId),
        source: text(entry.source),
        installed: false,
        installCount:
          typeof entry.installCount === 'number' && Number.isFinite(entry.installCount)
            ? Math.max(0, Math.trunc(entry.installCount))
            : 0
      }
    })
  }

  /**
   * Claude CLI 自带的 marketplace add 在做完整 clone，网络差时会卡在 120 秒。
   * 这里先用应用自己的浅层稀疏 clone 拉下 manifest，再让 CLI 注册本地目录；
   * 拉取失败就明确报错，不再让用户等第二次超时。
   */
  private async ensureMarketSource(): Promise<string | null> {
    const manifest = join(this.marketSourceDir, '.claude-plugin', 'marketplace.json')
    if (existsSync(manifest)) {
      this.renameMarket(manifest)
      return this.marketSourceDir
    }
    const git = resolveCommand('git')
    if (!git) return null
    if (existsSync(this.marketSourceDir)) {
      rmSync(this.marketSourceDir, { recursive: true, force: true })
    }
    mkdirSync(join(this.marketSourceDir, '..'), { recursive: true })
    try {
      await this.runProcess(
        git,
        ['clone', '--depth', '1', '--sparse', OFFICIAL_MARKETPLACE, this.marketSourceDir],
        CLONE_TIMEOUT
      )
      await this.runProcess(
        git,
        ['-C', this.marketSourceDir, 'sparse-checkout', 'set', '.claude-plugin', 'plugins'],
        CLI_TIMEOUT
      )
    } catch (error) {
      rmSync(this.marketSourceDir, { recursive: true, force: true })
      const message = error instanceof Error ? error.message : '未知错误'
      throw new Error(`官方市场拉取失败：${message}`)
    }
    if (!existsSync(manifest)) {
      rmSync(this.marketSourceDir, { recursive: true, force: true })
      throw new Error('官方市场缺少 marketplace.json')
    }
    this.renameMarket(manifest)
    return this.marketSourceDir
  }

  private async refreshMarketSource(): Promise<void> {
    const manifest = join(this.marketSourceDir, '.claude-plugin', 'marketplace.json')
    if (!existsSync(join(this.marketSourceDir, '.git'))) return
    const git = resolveCommand('git')
    if (!git) return
    await this.runProcess(
      git,
      ['-C', this.marketSourceDir, 'fetch', '--depth', '1', 'origin', 'main'],
      CLONE_TIMEOUT
    )
    await this.runProcess(
      git,
      ['-C', this.marketSourceDir, 'reset', '--hard', 'FETCH_HEAD'],
      CLI_TIMEOUT
    )
    await this.runProcess(
      git,
      ['-C', this.marketSourceDir, 'sparse-checkout', 'set', '.claude-plugin', 'plugins'],
      CLI_TIMEOUT
    )
    if (existsSync(manifest)) this.renameMarket(manifest)
  }

  /** 本地镜像必须改名，否则 Claude CLI 以「官方保留名」拒绝注册。 */
  private renameMarket(manifest: string): void {
    try {
      const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as Record<string, unknown>
      if (parsed.name === MARKET_NAME) return
      parsed.name = MARKET_NAME
      writeFileSync(manifest, JSON.stringify(parsed, null, 2), { encoding: 'utf8', mode: 0o600 })
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      throw new Error(`官方市场 manifest 处理失败：${message}`)
    }
  }

  private runProcess(cli: AgentCli, args: string[], timeoutMs: number): Promise<string> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(cli.bin, [...cli.prefixArgs, ...args], {
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true
      })
      let stdout = ''
      let stderr = ''
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        child.kill()
        reject(new Error('拉取官方市场超时'))
      }, timeoutMs)
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) reject(error)
        else resolvePromise(stdout)
      }
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        if (stdout.length < MAX_OUTPUT) stdout += chunk.slice(0, MAX_OUTPUT - stdout.length)
      })
      child.stderr.on('data', (chunk: string) => {
        if (stderr.length < 4000) stderr += chunk.slice(0, 4000 - stderr.length)
      })
      child.on('error', (error) => finish(error))
      child.on('close', (code) => {
        if (code === 0) {
          finish()
          return
        }
        const detail = stderr.trim().split(/\r?\n/).at(-1) ?? ''
        finish(new Error(detail || `git 退出码 ${code}`))
      })
    })
  }

  private async refreshInstalled(pluginId: string): Promise<InstallInfo | null> {
    const output = await this.run(['plugin', 'list', '--json'])
    const entries = pluginEntries(parsePluginJson(output))
    const entry = entries.find((item) => (item.id ?? item.pluginId ?? '') === pluginId)
    if (!entry) return null
    const installPath = text(entry.installPath)
    if (!installPath) return null
    const root = resolve(this.configDir)
    const target = resolve(installPath)
    const rel = relative(root, target)
    if (rel.startsWith('..') || rel.includes('..')) {
      throw new Error('插件目录不在应用私有目录内，已拒绝加载')
    }
    const name = text(entry.name) || pluginNameFromId(pluginId)
    const inventory = inspectPlugin(target)
    return {
      id: pluginId,
      name,
      description: text(entry.description),
      version: text(entry.version),
      marketplace: text(entry.marketplaceName) || marketplaceFromId(pluginId),
      installPath: target,
      ...inventory
    }
  }

  private withInstalled(entries: SkillMarketEntry[]): SkillMarketEntry[] {
    const installed = new Set(this.repository.listPlugins().map((plugin) => plugin.id))
    return entries.map((entry) => ({ ...entry, installed: installed.has(entry.pluginId) }))
  }

  private readCache(): MarketCache | null {
    try {
      const parsed = JSON.parse(readFileSync(this.cachePath, 'utf8')) as MarketCache
      if (!Array.isArray(parsed.entries) || typeof parsed.fetchedAt !== 'number') return null
      return parsed
    } catch {
      return null
    }
  }

  private writeCache(cache: MarketCache): void {
    try {
      mkdirSync(join(this.cachePath, '..'), { recursive: true })
      writeFileSync(this.cachePath, JSON.stringify(cache), { encoding: 'utf8', mode: 0o600 })
    } catch {
      // 缓存失败不影响本次结果
    }
  }

  private async cli(): Promise<AgentCli> {
    if (this.cliPromise === undefined) {
      this.cliPromise = this.cliOverride === undefined ? resolvePluginCli() : this.cliOverride
    }
    if (!this.cliPromise) {
      throw new Error('未找到 Claude CLI，无法读取插件市场')
    }
    return this.cliPromise
  }

  private async run(args: string[], timeoutMs = CLI_TIMEOUT): Promise<string> {
    const cli = await this.cli()
    return new Promise((resolvePromise, reject) => {
      const child = spawn(cli.bin, [...cli.prefixArgs, ...args], {
        cwd: this.configDir,
        env: {
          ...process.env,
          ...(cli.viaNode ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
          CLAUDE_CONFIG_DIR: this.configDir,
          NO_COLOR: '1'
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true
      })
      let stdout = ''
      let stderr = ''
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        child.kill()
        reject(new Error('Claude 插件命令超时'))
      }, timeoutMs)
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) reject(error)
        else resolvePromise(stdout)
      }
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        if (stdout.length < MAX_OUTPUT) stdout += chunk.slice(0, MAX_OUTPUT - stdout.length)
      })
      child.stderr.on('data', (chunk: string) => {
        if (stderr.length < MAX_OUTPUT) stderr += chunk.slice(0, MAX_OUTPUT - stderr.length)
      })
      child.on('error', (error) => finish(error))
      child.on('close', (code) => {
        if (code === 0) {
          finish()
          return
        }
        const detail = stderr.trim().split(/\r?\n/).at(-1) ?? ''
        finish(new Error(detail || `Claude 插件命令退出码 ${code}`))
      })
    })
  }
}

/** 测试与诊断用：应用私有插件目录。 */
export function pluginConfigDir(appDataDir: string): string {
  return join(appDataDir, 'agent', 'claude-plugins', 'config')
}

/** 读取目录名（主要给测试造数据用）。 */
export function listPluginDirs(root: string): string[] {
  try {
    return readdirSync(root)
  } catch {
    return []
  }
}
