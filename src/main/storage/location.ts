import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { homedir } from 'node:os'

/** 应用目录名；默认根与位置文件都挂在它下面。 */
export const APP_DIR_NAME = 'WorkStationForOne'
export const LOCATION_FILE_NAME = 'location.json'

/** 根目录下的固定子目录，顺序即界面展示顺序。 */
export const LAYOUT_KEYS = ['data', 'agent', 'codex-home'] as const

export interface StorageLayout {
  root: string
  dataDir: string
  dbFile: string
  backupDir: string
  agentDir: string
  pluginSourceDir: string
  claudePluginDir: string
  claudeConfigDir: string
  codexHome: string
}

export interface LocationState {
  /** 生效的根目录；空字符串表示用默认值 */
  root: string
  /** 已选定但尚未迁移的目标 */
  pending: string | null
  /** 上一次确认过的根目录，仅用于删除校验 */
  previous: string | null
  /** 读取失败时的可读原因；读取成功为空 */
  error: string
}

const EMPTY_STATE: LocationState = { root: '', pending: null, previous: null, error: '' }

/**
 * 默认根目录：`%APPDATA%\WorkStationForOne`。
 * 位置文件本身也在这里，所以它不能依赖位置文件的内容。
 */
export function defaultAppDir(appData: string): string {
  return join(appData, APP_DIR_NAME)
}

/** 兼容旧调用：测试与文档引用的固定说明值 */
export const DEFAULT_APP_DIR = join(homedir(), 'AppData', 'Roaming', APP_DIR_NAME)

export function locationFileFor(appData: string): string {
  return join(defaultAppDir(appData), LOCATION_FILE_NAME)
}

export function resolveLayout(root: string): StorageLayout {
  const base = resolve(root)
  const dataDir = join(base, 'data')
  const agentDir = join(base, 'agent')
  return {
    root: base,
    dataDir,
    dbFile: join(dataDir, 'workstation.db'),
    backupDir: join(dataDir, 'backups'),
    agentDir,
    pluginSourceDir: join(agentDir, 'plugin-sources'),
    claudePluginDir: join(agentDir, 'claude-plugins'),
    claudeConfigDir: join(agentDir, 'claude-config'),
    codexHome: join(base, 'codex-home')
  }
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 位置文件损坏时回退默认值，只记原因，不阻断启动。 */
export function readLocation(file: string): LocationState {
  if (!existsSync(file)) return { ...EMPTY_STATE }
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    const root = asString(raw.root)
    if (root && !isAbsolute(root)) {
      return { ...EMPTY_STATE, error: '位置文件里的根目录不是绝对路径，已回退默认目录' }
    }
    return {
      root,
      pending: asString(raw.pending) || null,
      previous: asString(raw.previous) || null,
      error: ''
    }
  } catch {
    return { ...EMPTY_STATE, error: '位置文件无法解析，已回退默认目录' }
  }
}

export function writeLocation(
  file: string,
  state: Pick<LocationState, 'root' | 'pending' | 'previous'>
): void {
  mkdirSync(dirname(file), { recursive: true })
  const payload = {
    root: state.root ?? '',
    pending: state.pending ?? null,
    previous: state.previous ?? null
  }
  writeFileSync(file, JSON.stringify(payload, null, 2), { encoding: 'utf8', mode: 0o600 })
}

export interface ResolveRootInput {
  locationFile: string
  /** `WS_DATA_DIR`（测试缝）；指向 data 目录，需要上溯一级作为根 */
  envDataDir?: string
  fallbackRoot: string
}

export interface ResolvedRoot {
  root: string
  source: 'env' | 'file' | 'default'
  location: LocationState
}

/**
 * 优先级：WS_DATA_DIR > 位置文件 > 默认根。
 * WS_DATA_DIR 历来指 data 目录，这里上溯一级，保持既有测试语义不变。
 */
export function resolveAppRoot(input: ResolveRootInput): ResolvedRoot {
  const location = readLocation(input.locationFile)
  const env = input.envDataDir?.trim()
  if (env) {
    const dataDir = resolve(env)
    return { root: dirname(dataDir), source: 'env', location }
  }
  if (location.root) return { root: location.root, source: 'file', location }
  return { root: resolve(input.fallbackRoot), source: 'default', location }
}

/** 判断 child 是否在 parent 之内（含相等）。 */
function contains(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * 校验迁移目标。返回空字符串表示可用，否则返回可读原因。
 * 不做文件系统检查（是否存在、是否为空由迁移阶段判断）。
 */
export function validateTargetRoot(target: string, current: string): string {
  if (!target.trim()) return '目标目录不能为空'
  if (!isAbsolute(target)) return '目标目录必须是绝对路径'
  if (contains(target, current) && contains(current, target)) return '目标目录与当前目录相同'
  if (contains(current, target)) return '目标目录不能是当前目录的子目录'
  if (contains(target, current)) return '目标目录不能是当前目录的父目录'
  return ''
}

/** 给界面用的目录说明，顺序与 LAYOUT_KEYS 一致。 */
export function describeLayout(layout: StorageLayout): string[] {
  return [layout.dataDir, layout.agentDir, layout.codexHome].map((dir) =>
    relative(layout.root, dir)
  )
}
