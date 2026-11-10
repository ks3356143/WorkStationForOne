import { spawn } from 'node:child_process'
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { RECOMMENDED_CLI_TOOLS } from '../../shared/recommendations'
import { effectiveSource, type CliSource } from '../../shared/runtime-source'
import type { CliRuntimeState, CliRuntimeUpdate } from '../../shared/ipc'
import { resolveCommand } from '../agent/cli'
import { probeCli } from './environment'
import { compareVersion } from './plugins/adapters'

const execFileAsync = promisify(execFile)

export interface ManagedRuntime {
  version: string
  binDir: string
}

export type RuntimePreferences = Record<string, CliSource>

const RUNTIME_IDS = ['uv', 'bun', 'node'] as const

function runtimeMeta(id: string) {
  return RECOMMENDED_CLI_TOOLS.find((tool) => tool.id === id)?.runtime
}

export function runtimeRoot(dataDir: string, id: string): string {
  return join(dataDir, 'runtimes', id)
}

/** 托管安装状态：current.json 标记 + 二进制齐全才算已装。 */
export function readManaged(dataDir: string, id: string): ManagedRuntime | null {
  const meta = runtimeMeta(id)
  if (!meta) return null
  const root = runtimeRoot(dataDir, id)
  try {
    const marker = JSON.parse(readFileSync(join(root, 'current.json'), 'utf8')) as {
      version?: string
    }
    if (!marker.version) return null
    const binDir = join(root, marker.version)
    if (!meta.binaries.every((name) => existsSync(join(binDir, name)))) return null
    return { version: marker.version, binDir }
  } catch {
    return null
  }
}

export function versionFromTag(tag: string, prefix: string): string {
  const withoutPrefix = prefix && tag.startsWith(prefix) ? tag.slice(prefix.length) : tag
  return withoutPrefix.replace(/^v/, '')
}

/** 只读查最新版本；离线 / 超时 / 形状不对都静默返回 null。 */
export async function fetchLatestVersion(
  meta: NonNullable<ReturnType<typeof runtimeMeta>>,
  fetchImpl: typeof fetch = fetch
): Promise<string | null> {
  try {
    const res = await fetchImpl(meta.releaseApi, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const body = (await res.json()) as unknown
    if (Array.isArray(body)) {
      // node 的 index.json 混有 alpha / nightly；最新版只认稳定版
      const first = (body as { version?: string }[]).find(
        (entry) => typeof entry.version === 'string' && !entry.version.includes('-')
      )
      return first?.version ? versionFromTag(first.version, 'v') : null
    }
    const tag = (body as { tag_name?: string }).tag_name
    return tag ? versionFromTag(tag, meta.tagPrefix) : null
  } catch {
    return null
  }
}

function escapePowerShellPath(value: string): string {
  return value.replace(/'/g, "''")
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(180_000) })
  if (!res.ok || !res.body) throw new Error(`下载失败：HTTP ${res.status}`)
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest))
}

/**
 * 托管安装：下载官方 zip（失败回退镜像）→ Expand-Archive → 只拷贝需要的二进制 →
 * 跑 --version 校验 → 写 current.json。按版本目录存放，替换时旧目录直接清理。
 */
export async function installRuntime(
  dataDir: string,
  id: string,
  options: { version?: string; assetUrl?: string } = {}
): Promise<ManagedRuntime> {
  const meta = runtimeMeta(id)
  if (!meta) throw new Error('这个工具不是环境依赖，不能托管安装')
  const version = options.version ?? (await fetchLatestVersion(meta))
  if (!version) throw new Error('拿不到最新版本号：网络不可达或接口变更，可手动下载后放置')
  const root = runtimeRoot(dataDir, id)
  mkdirSync(root, { recursive: true })
  const staging = join(root, `.staging-${version}`)
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  const zipPath = join(staging, 'package.zip')
  const urls = options.assetUrl
    ? [options.assetUrl]
    : [meta.assetUrl(version), ...(meta.mirrorUrl ? [meta.mirrorUrl(version)] : [])]
  let lastError: unknown = null
  let downloaded = false
  for (const url of urls) {
    try {
      await download(url, zipPath)
      downloaded = true
      break
    } catch (error) {
      lastError = error
    }
  }
  if (!downloaded) {
    rmSync(staging, { recursive: true, force: true })
    throw new Error(
      `下载失败（${lastError instanceof Error ? lastError.message : String(lastError)}）；可到 ${meta.assetUrl(version)} 手动下载放置`
    )
  }
  const extractDir = join(staging, 'extract')
  mkdirSync(extractDir, { recursive: true })
  await execFileAsync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${escapePowerShellPath(zipPath)}' -DestinationPath '${escapePowerShellPath(extractDir)}' -Force`
    ],
    { timeout: 120_000, windowsHide: true }
  )
  const binDir = join(root, version)
  rmSync(binDir, { recursive: true, force: true })
  mkdirSync(binDir, { recursive: true })
  const strip = meta.strip ? meta.strip.replace('{version}', version) : ''
  for (const name of meta.binaries) {
    const src = strip ? join(extractDir, strip, name) : join(extractDir, name)
    if (!existsSync(src)) {
      rmSync(staging, { recursive: true, force: true })
      throw new Error(`安装包里缺少 ${name}，资产命名可能已变更`)
    }
    copyFileSync(src, join(binDir, name))
  }
  // bun 的 zip 只有 bun.exe；补一个 bunx 转发 shim，命令面与系统安装一致
  if (id === 'bun') {
    writeFileSync(join(binDir, 'bunx.cmd'), '@"%~dp0bun.exe" x %*\r\n')
  }
  const versionLine = await readVersionLine(join(binDir, meta.binaries[0]))
  if (!versionLine) {
    rmSync(staging, { recursive: true, force: true })
    rmSync(binDir, { recursive: true, force: true })
    throw new Error('安装后校验失败：二进制无法运行')
  }
  writeFileSync(join(root, 'current.json'), JSON.stringify({ version }))
  for (const entry of readdirSync(root)) {
    if (entry !== version && entry !== 'current.json' && !entry.startsWith('.staging-')) {
      rmSync(join(root, entry), { recursive: true, force: true })
    }
  }
  rmSync(staging, { recursive: true, force: true })
  return { version, binDir }
}

function readVersionLine(bin: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(bin, ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true
    })
    let output = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve('')
    }, 8000)
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      if (output.length < 200) output += chunk.slice(0, 200 - output.length)
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve('')
    })
    child.on('close', () => {
      clearTimeout(timer)
      resolve(output.trim().split(/\r?\n/)[0] ?? '')
    })
  })
}

export function uninstallRuntime(dataDir: string, id: string): void {
  rmSync(runtimeRoot(dataDir, id), { recursive: true, force: true })
}

const COMMAND_TO_RUNTIME: Record<string, string> = {
  uv: 'uv',
  uvx: 'uv',
  bun: 'bun',
  bunx: 'bun',
  node: 'node',
  npx: 'node',
  npm: 'node'
}

/** 调用方先用 effectiveSource 判定生效源；只有生效源为托管时才返回托管二进制。 */
export function resolveManagedCli(
  dataDir: string,
  command: string,
  useManaged: boolean
): { bin: string; prefixArgs: string[] } | null {
  if (!useManaged) return null
  const id = COMMAND_TO_RUNTIME[command]
  if (!id) return null
  const managed = readManaged(dataDir, id)
  if (!managed) return null
  if (command === 'bunx') return { bin: join(managed.binDir, 'bun.exe'), prefixArgs: ['x'] }
  if (command === 'npx' || command === 'npm') {
    const cli = join(managed.binDir, 'node_modules', 'npm', 'bin', `${command}-cli.js`)
    if (!existsSync(cli)) return null
    return { bin: join(managed.binDir, 'node.exe'), prefixArgs: [cli] }
  }
  const bin = join(managed.binDir, `${command}.exe`)
  return existsSync(bin) ? { bin, prefixArgs: [] } : null
}

/** 注入子进程 PATH 的托管目录：生效源为托管且已安装的运行时才进 PATH。 */
export function managedPathPrefix(
  dataDir: string,
  preferences: RuntimePreferences,
  systemAvailable: Record<string, boolean>
): string {
  const dirs: string[] = []
  for (const id of RUNTIME_IDS) {
    const managed = readManaged(dataDir, id)
    if (!managed) continue
    const source = effectiveSource(preferences[id], {
      systemAvailable: systemAvailable[id] === true,
      managedInstalled: true
    })
    if (source === 'managed') dirs.push(managed.binDir)
  }
  return dirs.join(';')
}
export interface RuntimeServiceDeps {
  dataDir: string
  repository: {
    listCliSources(): RuntimePreferences
    setCliSource(name: string, source: CliSource): void
  }
}

const PRIMARY_COMMAND: Record<string, string> = { uv: 'uv', bun: 'bun', node: 'node' }

/** 环境依赖的统一门面：状态 / 更新检查 / 源选择 / 安装卸载 / 启动改写。 */
export function createRuntimeService(deps: RuntimeServiceDeps) {
  const preferences = () => deps.repository.listCliSources()
  const systemAvailable = (id: string) => Boolean(resolveCommand(PRIMARY_COMMAND[id]))

  const rewrite = (command: string, args: string[]): { command: string; args: string[] } => {
    const id = COMMAND_TO_RUNTIME[command]
    if (!id) return { command, args }
    const managed = readManaged(deps.dataDir, id)
    const source = effectiveSource(preferences()[id], {
      systemAvailable: systemAvailable(id),
      managedInstalled: Boolean(managed)
    })
    if (source !== 'managed') return { command, args }
    const resolved = resolveManagedCli(deps.dataDir, command, true)
    if (!resolved) return { command, args }
    return { command: resolved.bin, args: [...resolved.prefixArgs, ...args] }
  }

  const pathPrefix = () =>
    managedPathPrefix(
      deps.dataDir,
      preferences(),
      Object.fromEntries(RUNTIME_IDS.map((id) => [id, systemAvailable(id)]))
    )

  const states = async (): Promise<CliRuntimeState[]> =>
    Promise.all(
      RUNTIME_IDS.map(async (id) => {
        const system = await probeCli(PRIMARY_COMMAND[id])
        const managed = readManaged(deps.dataDir, id)
        const preference = preferences()[id] ?? null
        return {
          id,
          system,
          managed: {
            installed: Boolean(managed),
            version: managed?.version ?? '',
            binDir: managed?.binDir ?? ''
          },
          preference,
          effective: effectiveSource(preference, {
            systemAvailable: system.available,
            managedInstalled: Boolean(managed)
          })
        }
      })
    )

  const updates = async (): Promise<CliRuntimeUpdate[]> => {
    const list = await states()
    return Promise.all(
      list.map(async (state) => {
        const installedVersion =
          state.effective === 'managed' ? state.managed.version : state.system.version
        if (!installedVersion) {
          return { id: state.id, installedVersion: '', latestVersion: '', hasUpdate: false }
        }
        const meta = runtimeMeta(state.id)
        const latest = meta ? await fetchLatestVersion(meta) : null
        return {
          id: state.id,
          installedVersion,
          latestVersion: latest ?? '',
          hasUpdate: Boolean(latest && compareVersion(latest, installedVersion) > 0)
        }
      })
    )
  }

  return {
    states,
    updates,
    rewrite,
    pathPrefix,
    preferences,
    setSource: (id: string, source: CliSource) => deps.repository.setCliSource(id, source),
    install: (id: string) => installRuntime(deps.dataDir, id),
    uninstall: (id: string) => uninstallRuntime(deps.dataDir, id)
  }
}

export type RuntimeService = ReturnType<typeof createRuntimeService>
