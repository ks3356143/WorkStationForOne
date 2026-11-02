import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { PluginAgent } from '../../../shared/ipc'
import { splitPluginId } from './components'

export interface LocalMarketplace {
  name: string
  /** 可直接添加进应用的源地址：Git 地址或本地绝对路径 */
  source: string
  /** source_type，用于界面标注 */
  kind: 'git' | 'local' | 'unknown'
}

export interface LocalPlugin {
  /** `name@market` */
  id: string
  name: string
  market: string
  version: string
  enabled: boolean
  /** 本机安装目录；便于离线导入时直接复制 */
  installPath: string
}

export interface LocalScanResult {
  agent: PluginAgent
  detected: boolean
  marketplaces: LocalMarketplace[]
  plugins: LocalPlugin[]
  errors: string[]
}

/** 只读扫描根目录：默认 `~`，自动化用 WS_PLUGIN_SCAN_ROOT 指向临时 home。 */
export function scanRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.WS_PLUGIN_SCAN_ROOT?.trim() || homedir()
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** 扫描 Claude：known_marketplaces.json 给源，installed_plugins.json 给已装插件。 */
export function scanClaudeLocal(root = scanRoot()): LocalScanResult {
  const base = join(root, '.claude', 'plugins')
  const result: LocalScanResult = {
    agent: 'claude',
    detected: existsSync(base),
    marketplaces: [],
    plugins: [],
    errors: []
  }
  if (!result.detected) return result

  const markets = readJson(join(base, 'known_marketplaces.json'))
  if (markets) {
    for (const [name, raw] of Object.entries(markets)) {
      const source = asRecord(asRecord(raw).source)
      const repo = typeof source.repo === 'string' ? source.repo : ''
      const path = typeof source.path === 'string' ? source.path : ''
      const type = typeof source.source === 'string' ? source.source : ''
      const value = path || (repo ? `https://github.com/${repo}` : '')
      if (!value) continue
      result.marketplaces.push({
        name,
        source: value,
        kind: type === 'directory' || path ? 'local' : 'git'
      })
    }
  } else {
    result.errors.push('known_marketplaces.json 无法解析')
  }

  const installed = readJson(join(base, 'installed_plugins.json'))
  const plugins = asRecord(installed?.plugins)
  for (const [id, raw] of Object.entries(plugins)) {
    const { name, market } = splitPluginId(id)
    if (!name) continue
    // 同一插件可能有多条 scope 记录，取最新一条的安装路径与版本
    const entries = Array.isArray(raw) ? raw : [raw]
    const pick = asRecord(entries[entries.length - 1])
    result.plugins.push({
      id,
      name,
      market,
      version: typeof pick.version === 'string' ? pick.version : '',
      enabled: true,
      installPath: typeof pick.installPath === 'string' ? pick.installPath : ''
    })
  }
  return result
}

/** 扫描 Codex：config.toml 的 [marketplaces.*] 与 [plugins."x@y"]，缓存目录给路径。 */
export function scanCodexLocal(root = scanRoot()): LocalScanResult {
  const base = join(root, '.codex')
  const result: LocalScanResult = {
    agent: 'codex',
    detected: existsSync(base),
    marketplaces: [],
    plugins: [],
    errors: []
  }
  if (!result.detected) return result

  const configFile = join(base, 'config.toml')
  const text = existsSync(configFile) ? readFileSync(configFile, 'utf8') : ''
  if (!text) {
    result.errors.push('config.toml 不存在或为空')
    return result
  }

  result.marketplaces = parseMarketplaceTables(text)
  for (const entry of parsePluginTables(text)) {
    const { name, market } = splitPluginId(entry.selector)
    if (!name) continue
    result.plugins.push({
      id: entry.selector,
      name,
      market,
      version: cacheVersion(base, market, name),
      enabled: entry.enabled,
      installPath: cachePath(base, market, name)
    })
  }
  return result
}

function parseMarketplaceTables(text: string): LocalMarketplace[] {
  const list: LocalMarketplace[] = []
  const sections = splitTables(text)
  for (const section of sections) {
    const match = /^\[marketplaces\.(.+)\]$/.exec(section.header)
    if (!match) continue
    const name = unquote(match[1])
    const type = /source_type\s*=\s*"([^"]+)"/.exec(section.body)?.[1] ?? 'unknown'
    const source = /source\s*=\s*['"]([^'"]+)['"]/.exec(section.body)?.[1] ?? ''
    if (!source) continue
    // Codex 的本地源会带 \\?\ 长路径前缀，去掉后才能被应用识别为绝对路径
    const clean = source.replace(/^\\\\\?\\/, '')
    list.push({
      name,
      source: clean,
      kind: type === 'git' ? 'git' : type === 'local' ? 'local' : 'unknown'
    })
  }
  return list
}

function parsePluginTables(text: string): Array<{ selector: string; enabled: boolean }> {
  const list: Array<{ selector: string; enabled: boolean }> = []
  for (const section of splitTables(text)) {
    const match = /^\[plugins\.(.+)\]$/.exec(section.header)
    if (!match) continue
    const enabled = /enabled\s*=\s*(true|false)/.exec(section.body)?.[1] === 'true'
    list.push({ selector: unquote(match[1]), enabled })
  }
  return list
}

interface TomlSection {
  header: string
  body: string
}

function splitTables(text: string): TomlSection[] {
  const sections: TomlSection[] = []
  let current: TomlSection | null = null
  for (const line of text.split(/\r?\n/)) {
    const header = line.trim()
    if (header.startsWith('[')) {
      if (current) sections.push(current)
      current = { header, body: '' }
      continue
    }
    if (current) current.body += `${line}\n`
  }
  if (current) sections.push(current)
  return sections
}

/** TOML 表头里的键可能带引号，也可能是裸标识符。 */
function unquote(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1)
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1)
  return trimmed
}

function cachePath(base: string, market: string, name: string): string {
  const dir = join(base, 'plugins', 'cache', market, name)
  return existsSync(dir) ? dir : ''
}

function cacheVersion(base: string, market: string, name: string): string {
  const dir = join(base, 'plugins', 'cache', market, name)
  if (!existsSync(dir)) return ''
  try {
    const versions = readdirSafe(dir)
    return versions.sort().at(-1) ?? ''
  } catch {
    return ''
  }
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

export function scanLocal(agent: PluginAgent, root = scanRoot()): LocalScanResult {
  return agent === 'claude' ? scanClaudeLocal(root) : scanCodexLocal(root)
}
