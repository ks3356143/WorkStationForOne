import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const MAX_NAME = 60
const GIT_TIMEOUT = 180_000

/** 名称进 SQL、目录名与 CLI 参数，先卡死字符集。 */
export function assertSourceName(value: string): string {
  const name = value.trim()
  if (!name) throw new Error('源名称不能为空')
  if (name.length > MAX_NAME) throw new Error('源名称过长（最多 60 字）')
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error('源名称只能包含字母、数字、点、下划线与连字符')
  }
  return name
}

/**
 * 地址校验：只接受 `owner/repo`、HTTPS、SSH 与本地绝对路径。
 * 拒绝空白与 shell 元字符——命令虽然 shell:false，仍不想把可疑串传给 git。
 */
export function validateSourceUrl(value: string): string {
  const url = value.trim()
  if (!url) return '源地址不能为空'
  if (/[\s;|&$`<>]/.test(url)) return '源地址包含非法字符'
  if (/^\.{1,2}[\\/]/.test(url)) return '本地源需使用绝对路径'
  if (/^[A-Za-z]:[\\/]/.test(url) || url.startsWith('\\\\')) return ''
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) return ''
  if (/^https:\/\/[^\s]+$/i.test(url)) return ''
  if (/^(ssh|git):\/\/[^\s]+$/i.test(url)) return ''
  if (/^git@[\w.-]+:[\w./-]+$/.test(url)) return ''
  if (isAbsolute(url)) return ''
  return '源地址需为 owner/repo、HTTPS / SSH 地址或绝对路径'
}

export function isLocalPath(url: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(url) || url.startsWith('\\\\') || isAbsolute(url)
}

/** 目录名：slug 化名称，避开与官方保留名冲突。 */
export function sourceSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  const slug = base || 'source'
  return slug === 'wsfo-official' ? `${slug}-local` : slug
}

/**
 * 清单里的 source 有三种真实形态：
 * - 相对路径字符串（`./plugins/x`）
 * - `{ source: 'url', url }`：插件在另一个 Git 仓库
 * - `{ source: 'git-subdir', url, path, ref }`：另一个仓库的子目录
 * 后两种无法用本地路径引用，标记为 external 供界面说明。
 */
export type MarketplaceSourceKind = 'local' | 'url' | 'git-subdir'

export interface MarketplacePlugin {
  name: string
  /** 相对路径（local）或外部 Git 地址 */
  source: string
  sourceKind: MarketplaceSourceKind
  /** git-subdir 的子目录 */
  subdir: string
  description: string
}

export interface MarketplaceManifest {
  name: string
  plugins: MarketplacePlugin[]
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** source 不得跑出仓库：`..` 会让安装指向源目录之外。 */
function parseSource(raw: unknown): {
  source: string
  sourceKind: MarketplaceSourceKind
  subdir: string
} {
  if (typeof raw === 'string') {
    return { source: raw.trim(), sourceKind: 'local', subdir: '' }
  }
  const record = asRecord(raw)
  const kind = typeof record.source === 'string' ? record.source : ''
  if (kind === 'git-subdir') {
    return {
      source: typeof record.url === 'string' ? record.url.trim() : '',
      sourceKind: 'git-subdir',
      subdir: typeof record.path === 'string' ? record.path.trim() : ''
    }
  }
  if (kind === 'url') {
    return {
      source: typeof record.url === 'string' ? record.url.trim() : '',
      sourceKind: 'url',
      subdir: ''
    }
  }
  // 未知形态按本地处理，交由上层校验
  return { source: '', sourceKind: 'local', subdir: '' }
}

function assertInsideRoot(source: string): void {
  if (!source) return
  const rel = relative('/', source.replace(/\\/g, '/'))
  void rel
  if (/^\.\.([\\/]|$)/.test(source) || source.includes('../') || source.includes('..\\')) {
    throw new Error('插件 source 指向仓库外，已拒绝')
  }
}

/**
 * 解析 `.claude-plugin/marketplace.json`。
 * Claude 与 Codex 共用同一格式；Codex 不认 `.codex-plugin/`。
 */
export function parseMarketplace(text: string): MarketplaceManifest {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('marketplace.json 不是合法 JSON')
  }
  const record = asRecord(raw)
  const name = typeof record.name === 'string' ? record.name.trim() : ''
  if (!name) throw new Error('marketplace.json 缺少 name')
  const list = Array.isArray(record.plugins) ? record.plugins : []
  const plugins: MarketplacePlugin[] = []
  for (const item of list) {
    const entry = asRecord(item)
    const pluginName = typeof entry.name === 'string' ? entry.name.trim() : ''
    if (!pluginName) continue
    const parsed = parseSource(entry.source)
    // 只有本地相对路径需要做越界检查；外部地址由安装阶段处理
    if (parsed.sourceKind === 'local') assertInsideRoot(parsed.source)
    plugins.push({
      name: pluginName,
      source: parsed.source,
      sourceKind: parsed.sourceKind,
      subdir: parsed.subdir,
      description: typeof entry.description === 'string' ? entry.description.slice(0, 240) : ''
    })
  }
  return { name, plugins }
}

export function readMarketplace(root: string): MarketplaceManifest {
  const file = join(root, '.claude-plugin', 'marketplace.json')
  if (!existsSync(file)) throw new Error('源仓库缺少 .claude-plugin/marketplace.json')
  return parseMarketplace(readFileSync(file, 'utf8'))
}

export function resolvePluginSource(root: string, source: string): string {
  if (!source) return root
  assertInsideRoot(source)
  return resolve(root, source)
}

function gitEnv(): NodeJS.ProcessEnv {
  // 禁止交互式凭据提示，否则 HTTPS 私有仓库会让克隆一直挂着
  return { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' }
}

async function git(args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await run('git', args, {
      cwd,
      timeout: GIT_TIMEOUT,
      windowsHide: true,
      shell: false,
      env: gitEnv()
    })
    return stdout
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'git 执行失败'
    throw new Error(detail.split(/\r?\n/).filter(Boolean).at(-1) ?? 'git 执行失败')
  }
}

/** 克隆到目标目录；目标已存在时拒绝，避免覆盖用户目录。 */
export async function cloneSource(url: string, target: string, ref: string): Promise<void> {
  if (isLocalPath(url)) {
    if (!existsSync(url)) throw new Error('本地源目录不存在')
    return
  }
  if (existsSync(target)) throw new Error('源目录已存在，先移除旧源')
  const args = ['clone', '--depth', '1']
  if (ref) args.push('--branch', ref)
  args.push('--', url, target)
  await git(args)
}

export async function refreshSource(target: string, ref: string): Promise<void> {
  if (!existsSync(join(target, '.git'))) throw new Error('不是 Git 仓库，无法刷新')
  const branch = ref || 'HEAD'
  await git(['fetch', '--depth', '1', 'origin', branch], target)
  await git(['reset', '--hard', 'FETCH_HEAD'], target)
}
