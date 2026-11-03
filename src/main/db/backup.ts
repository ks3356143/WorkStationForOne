import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import type { BackupEntry } from '../../shared/ipc'

export const BACKUP_DIR = 'backups'
export const KEEP_BACKUPS = 10
const PREFIX = 'workstation-'

/** 可恢复的文件名：普通备份、同秒冲突后缀，或恢复前自动留下的 -pre 快照。 */
export const BACKUP_NAME_RE = /^workstation-\d{8}-\d{6}(?:-\d+|-pre(?:-\d+)?)?\.db$/

export function isBackupFileName(name: string): boolean {
  return BACKUP_NAME_RE.test(name)
}

/** 备份文件名带本地时间戳，纯函数便于测试。 */
export function backupFileName(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${PREFIX}${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours()
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}.db`
}

export function backupDirFor(dbFile: string): string {
  return join(dirname(dbFile), BACKUP_DIR)
}

/** 按文件名排序取最新一份（文件名里的时间戳是定长的，字典序即时间序）。 */
export function listBackups(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.startsWith(PREFIX) && name.endsWith('.db'))
    .sort()
}

export function pruneBackups(dir: string, keep = KEEP_BACKUPS): string[] {
  const files = listBackups(dir)
  const removed: string[] = []
  for (const name of files.slice(0, Math.max(0, files.length - keep))) {
    try {
      unlinkSync(join(dir, name))
      removed.push(name)
    } catch {
      // 删不掉就留着，备份多一点不该变成故障
    }
  }
  return removed
}

function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

/**
 * VACUUM INTO 生成一致性快照：不需要停写入，也不会拷到 WAL 中间态。
 * 目标文件必须不存在，所以先确保目录干净。
 */
export function createBackup(db: DatabaseSync, dir: string, now = new Date()): string {
  mkdirSync(dir, { recursive: true })
  const base = backupFileName(now)
  let file = join(dir, base)
  let index = 1
  while (existsSync(file)) {
    index += 1
    file = join(dir, base.replace(/\.db$/, `-${index}.db`))
  }
  db.exec(`VACUUM INTO ${quote(file)}`)
  pruneBackups(dir)
  return file
}

/** 今天还没有备份就补一份；返回新建的文件，已存在则返回 null。 */
export function ensureDailyBackup(db: DatabaseSync, dir: string, now = new Date()): string | null {
  const today = backupFileName(now).slice(PREFIX.length, PREFIX.length + 8)
  const latest = listBackups(dir).at(-1)
  if (latest && latest.slice(PREFIX.length, PREFIX.length + 8) === today) return null
  return createBackup(db, dir, now)
}

export function backupSize(file: string): number {
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}

/** 设置页列表：只认可恢复的文件，按修改时间倒序。 */
export function backupEntries(dir: string): BackupEntry[] {
  if (!existsSync(dir)) return []
  const entries: BackupEntry[] = []
  for (const name of readdirSync(dir)) {
    if (!isBackupFileName(name)) continue
    try {
      const stat = statSync(join(dir, name))
      entries.push({
        name,
        bytes: stat.size,
        at: stat.mtimeMs,
        safety: name.includes('-pre')
      })
    } catch {
      // 列表读取期间文件被清理时直接跳过
    }
  }
  return entries.sort((a, b) => b.at - a.at)
}

/**
 * 恢复前留一份当前库的快照。文件名带 -pre，设置页会标成「恢复前快照」，
 * 也可以再次被恢复。
 */
export function createSafetyBackup(db: DatabaseSync, dir: string, now = new Date()): string {
  mkdirSync(dir, { recursive: true })
  const base = backupFileName(now).replace(/\.db$/, '')
  let file = join(dir, `${base}-pre.db`)
  let index = 1
  while (existsSync(file)) {
    index += 1
    file = join(dir, `${base}-pre-${index}.db`)
  }
  db.exec(`VACUUM INTO ${quote(file)}`)
  pruneBackups(dir)
  return file
}
