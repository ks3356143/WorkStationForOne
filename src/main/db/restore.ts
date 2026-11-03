import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { RestoreStateInfo } from '../../shared/ipc'
import { createSafetyBackup, isBackupFileName } from './backup'
import { MIGRATIONS, migrate, openDatabase, userVersion } from './database'

export const RESTORE_FILE = 'restore.json'

export type RestoreStatus = 'none' | 'pending' | 'applying' | 'applied' | 'failed'

/** restore.json 同时承载「待生效」和「上次结果」，全部在开库之前读写。 */
export interface RestoreState {
  status: RestoreStatus
  backup: string
  at: number
  error: string
  safety: string
  /** 启动替换时的回滚目录基名；不暴露给渲染层 */
  pre: string
}

const EMPTY: RestoreState = {
  status: 'none',
  backup: '',
  at: 0,
  error: '',
  safety: '',
  pre: ''
}

const CORE_TABLES = [
  'tasks',
  'notes',
  'learning_items',
  'habits',
  'habit_checkins',
  'agent_sessions',
  'agent_messages',
  'audit_log'
]

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function messageOf(error: unknown): string {
  const raw = error instanceof Error ? error.message : ''
  return raw.trim() || '恢复失败'
}

function stateFile(dataDir: string): string {
  return join(dataDir, RESTORE_FILE)
}

export function readRestoreState(dataDir: string): RestoreState {
  const file = stateFile(dataDir)
  if (!existsSync(file)) return { ...EMPTY }
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    const status = raw.status
    if (
      status !== 'pending' &&
      status !== 'applying' &&
      status !== 'applied' &&
      status !== 'failed'
    ) {
      return { ...EMPTY, status: 'failed', error: '恢复状态文件内容无效' }
    }
    return {
      status,
      backup: asString(raw.backup),
      at: typeof raw.at === 'number' && Number.isFinite(raw.at) ? raw.at : 0,
      error: asString(raw.error),
      safety: asString(raw.safety),
      pre: asString(raw.pre)
    }
  } catch {
    return { ...EMPTY, status: 'failed', error: '恢复状态文件无法解析' }
  }
}

function writeRestoreState(dataDir: string, state: RestoreState): void {
  mkdirSync(dataDir, { recursive: true })
  const file = stateFile(dataDir)
  const temp = `${file}.tmp`
  writeFileSync(temp, JSON.stringify(state, null, 2), { encoding: 'utf8', mode: 0o600 })
  renameSync(temp, file)
}

export function restoreInfo(state = EMPTY): RestoreStateInfo {
  return {
    status: state.status,
    backup: state.backup,
    at: state.at,
    error: state.error,
    safety: state.safety
  }
}

export function readRestoreInfo(dataDir: string): RestoreStateInfo {
  return restoreInfo(readRestoreState(dataDir))
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** 只读检查：完整性、版本不能高于当前应用、至少要有任务表。 */
export function inspectBackup(file: string): { userVersion: number } {
  if (!existsSync(file)) throw new Error('备份文件不存在，可能已被清理')
  let db: DatabaseSync
  try {
    db = new DatabaseSync(file, { readOnly: true })
  } catch {
    throw new Error('备份文件不是有效的数据库')
  }
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get() as
      | { integrity_check?: string }
      | undefined
    if (integrity?.integrity_check !== 'ok') throw new Error('备份完整性校验失败')
    const version = userVersion(db)
    const latest = MIGRATIONS.at(-1)?.version ?? version
    if (version < 1) throw new Error('备份不是有效的数据库')
    if (version > latest) throw new Error('备份来自更新版本，当前应用无法恢复')
    const tasks = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tasks'")
      .get()
    if (!tasks) throw new Error('备份缺少任务表，无法恢复')
    return { userVersion: version }
  } catch (error) {
    const message = messageOf(error)
    if (/not a database|malformed|corrupt/i.test(message)) {
      throw new Error('备份文件不是有效的数据库')
    }
    throw error instanceof Error ? error : new Error(message)
  } finally {
    db.close()
  }
}

export interface RequestRestoreInput {
  db: DatabaseSync
  backupDir: string
  dataDir: string
  name: string
}

export interface RequestRestoreResult {
  backup: string
  safety: string
}

/**
 * 只做校验、留安全快照并写待恢复记录；真正的替换在下次启动开库前执行。
 * 这样运行中的连接、MCP 桥与提醒轮询都不需要中途停掉。
 */
export function requestRestore(input: RequestRestoreInput): RequestRestoreResult {
  const name = input.name.trim()
  if (!isBackupFileName(name) || basename(name) !== name) {
    throw new Error('备份文件名无效')
  }
  const file = resolve(input.backupDir, name)
  if (!isInside(input.backupDir, file)) throw new Error('备份路径无效')
  const state = readRestoreState(input.dataDir)
  if (state.status === 'pending' || state.status === 'applying') {
    throw new Error('已有一份恢复等待重启，请先重启应用')
  }
  inspectBackup(file)
  const safetyFile = createSafetyBackup(input.db, input.backupDir)
  writeRestoreState(input.dataDir, {
    status: 'pending',
    backup: name,
    at: Date.now(),
    error: '',
    safety: basename(safetyFile),
    pre: ''
  })
  return { backup: name, safety: basename(safetyFile) }
}

function verifyRestoredDb(file: string): void {
  const db = openDatabase(file)
  try {
    const integrity = db.prepare('PRAGMA integrity_check').get() as
      | { integrity_check?: string }
      | undefined
    if (integrity?.integrity_check !== 'ok') throw new Error('恢复后的数据库完整性校验失败')
    migrate(db)
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string
    }[]
    const names = new Set(rows.map((row) => row.name))
    for (const table of CORE_TABLES) {
      if (!names.has(table)) throw new Error(`恢复后的数据库缺少 ${table} 表`)
    }
  } finally {
    db.close()
  }
}

function removeDbFiles(dbFile: string): void {
  for (const suffix of ['', '-wal', '-shm']) rmSync(`${dbFile}${suffix}`, { force: true })
}

function cleanupOrphanPre(dbFile: string): void {
  const dir = dirname(dbFile)
  const prefix = `${basename(dbFile)}.pre-restore-`
  try {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(prefix)) rmSync(join(dir, name), { force: true })
    }
  } catch {
    // 清理失败不影响使用，下次启动再试
  }
}

function failRestore(
  input: ApplyRestoreInput,
  state: RestoreState,
  error: string
): ApplyRestoreResult {
  writeRestoreState(input.dataDir, { ...state, status: 'failed', error, pre: '' })
  return { applied: false, error }
}

function rollbackInterrupted(input: ApplyRestoreInput, state: RestoreState): ApplyRestoreResult {
  const pre = state.pre
  const hasPre =
    Boolean(pre) && ['', '-wal', '-shm'].some((suffix) => existsSync(`${pre}${suffix}`))
  if (!hasPre) {
    return failRestore(input, state, '上次恢复被中断，但找不到回滚文件；当前数据库保持不变')
  }
  try {
    removeDbFiles(input.dbFile)
    for (const suffix of ['', '-wal', '-shm']) {
      const from = `${pre}${suffix}`
      if (existsSync(from)) renameSync(from, `${input.dbFile}${suffix}`)
    }
    return failRestore(input, state, '上次恢复在启动前被中断，已回滚到恢复前的数据库')
  } catch (error) {
    return failRestore(input, state, `上次恢复中断，回滚失败：${messageOf(error)}`)
  }
}

export interface ApplyRestoreInput {
  dbFile: string
  dataDir: string
  backupDir: string
}

export interface ApplyRestoreResult {
  applied: boolean
  error?: string
  backup?: string
}

/**
 * 启动阶段、开库之前执行。顺序是：校验备份 → 把当前库改名留底 → 复制备份 →
 * 开库校验并迁移 → 成功才记 applied；任一步失败都把原名文件换回来。
 */
export function applyPendingRestore(input: ApplyRestoreInput): ApplyRestoreResult {
  const state = readRestoreState(input.dataDir)
  if (state.status === 'applying') return rollbackInterrupted(input, state)
  if (state.status === 'applied') {
    cleanupOrphanPre(input.dbFile)
    return { applied: false }
  }
  if (state.status !== 'pending') return { applied: false }

  if (!isBackupFileName(state.backup)) {
    return failRestore(input, state, '恢复记录里的备份文件名无效')
  }
  const backupFile = resolve(input.backupDir, state.backup)
  if (!isInside(input.backupDir, backupFile)) {
    return failRestore(input, state, '恢复记录里的备份路径无效')
  }
  try {
    inspectBackup(backupFile)
  } catch (error) {
    return failRestore(input, state, messageOf(error))
  }

  const pre = `${input.dbFile}.pre-restore-${Date.now()}`
  writeRestoreState(input.dataDir, { ...state, status: 'applying', pre })
  const moved: { from: string; to: string }[] = []
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      const from = `${input.dbFile}${suffix}`
      if (!existsSync(from)) continue
      const to = `${pre}${suffix}`
      renameSync(from, to)
      moved.push({ from, to })
    }
    copyFileSync(backupFile, input.dbFile)
    verifyRestoredDb(input.dbFile)
    writeRestoreState(input.dataDir, {
      ...state,
      status: 'applied',
      at: Date.now(),
      error: '',
      pre: ''
    })
    for (const item of moved) {
      try {
        rmSync(item.to, { force: true })
      } catch {
        // 删除失败只是在数据目录留下回滚副本；启动时会再清理
      }
    }
    return { applied: true, backup: state.backup }
  } catch (error) {
    const message = messageOf(error)
    removeDbFiles(input.dbFile)
    for (const item of moved) {
      try {
        renameSync(item.to, item.from)
      } catch {
        // 单个文件换不回去也继续尝试其余文件
      }
    }
    return failRestore(input, state, message)
  }
}
