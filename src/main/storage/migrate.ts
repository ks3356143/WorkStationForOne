import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { validateTargetRoot, type LocationState } from './location'

export interface MigrateInput {
  currentRoot: string
  targetRoot: string
  locationFile: string
  location: LocationState
  /** 测试缝：跳过磁盘空间检查 */
  skipSpaceCheck?: boolean
}

export interface MigrateResult {
  ok: boolean
  /** 迁移成功后实际生效的根目录；失败时为原根目录 */
  root: string
  /** 失败原因；成功为空 */
  error: string
  /** 旧根是否已删除；删除失败时保留路径供界面提示 */
  removedOld: boolean
  oldRoot: string
}

function dirSize(dir: string): number {
  if (!existsSync(dir)) return 0
  let total = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    try {
      total += entry.isDirectory() ? dirSize(full) : statSync(full).size
    } catch {
      // 单个文件读不到不影响整体估算
    }
  }
  return total
}

function freeBytes(dir: string): number | null {
  if (process.platform !== 'win32') return null
  const drive = dir.slice(0, 2)
  const result = spawnSync(
    'powershell',
    ['-NoProfile', '-Command', `(Get-PSDrive -Name '${drive[0]}').Free`],
    { encoding: 'utf8', windowsHide: true, timeout: 10_000, shell: false }
  )
  if (result.status !== 0) return null
  const value = Number(result.stdout.trim())
  return Number.isFinite(value) && value > 0 ? value : null
}

/** 校验复制出的库：能打开、完整性通过、表数量与源库一致。 */
function verifyDatabase(sourceDb: string, copiedDb: string): string {
  if (!existsSync(copiedDb)) return '复制后的数据库不存在'
  let source: DatabaseSync | null = null
  let copied: DatabaseSync | null = null
  try {
    source = new DatabaseSync(sourceDb, { readOnly: true })
    copied = new DatabaseSync(copiedDb, { readOnly: true })
    const integrity = copied.prepare('PRAGMA integrity_check').get() as
      | { integrity_check?: string }
      | undefined
    if (integrity?.integrity_check !== 'ok') return '复制后的数据库完整性检查未通过'
    const count = (db: DatabaseSync): number => {
      const row = db
        .prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table'")
        .get() as { n?: number } | undefined
      return Number(row?.n ?? 0)
    }
    if (count(source) !== count(copied)) return '复制后的数据库表数量与源库不一致'
    return ''
  } catch (error) {
    return `复制后的数据库无法打开：${error instanceof Error ? error.message : '未知错误'}`
  } finally {
    try {
      source?.close()
    } catch {
      // 关库失败不影响结论
    }
    try {
      copied?.close()
    } catch {
      // 同上
    }
  }
}

/** 清理上次中断留下的 `<target>.migrating-*` 残骸。 */
export function cleanupStale(targetRoot: string): void {
  const parent = join(targetRoot, '..')
  if (!existsSync(parent)) return
  const prefix = `${targetRoot.split(/[\\/]/).pop()}.migrating-`
  for (const entry of readdirSync(parent, { withFileTypes: true })) {
    if (entry.name.startsWith(prefix)) {
      rmSync(join(parent, entry.name), { recursive: true, force: true })
    }
  }
}

/**
 * 复制 → 校验 → 落位 → 切指针 → 删旧根。
 * 任何一步失败都保留原根与位置文件，只返回原因。
 */
export function migrateRoot(input: MigrateInput): MigrateResult {
  const fail = (error: string): MigrateResult => ({
    ok: false,
    root: input.currentRoot,
    error,
    removedOld: false,
    oldRoot: input.currentRoot
  })

  const invalid = validateTargetRoot(input.targetRoot, input.currentRoot)
  if (invalid) return fail(invalid)

  if (existsSync(input.targetRoot)) {
    const entries = readdirSync(input.targetRoot)
    if (entries.length > 0) return fail('目标目录不为空，请选择一个空目录或新建目录')
  } else {
    try {
      mkdirSync(input.targetRoot, { recursive: true })
    } catch (error) {
      return fail(`无法创建目标目录：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  if (!input.skipSpaceCheck) {
    const needed = dirSize(input.currentRoot)
    const free = freeBytes(input.targetRoot)
    if (free !== null && free < needed * 1.1) {
      return fail(
        `目标磁盘剩余空间不足：需要约 ${Math.ceil(needed / 1024 / 1024)} MB，可用 ${Math.floor(free / 1024 / 1024)} MB`
      )
    }
  }

  cleanupStale(input.targetRoot)
  const staging = `${input.targetRoot}.migrating-${Date.now()}`

  try {
    cpSync(input.currentRoot, staging, { recursive: true, force: false, errorOnExist: false })
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    return fail(`复制失败：${error instanceof Error ? error.message : '未知错误'}`)
  }

  const dbError = verifyDatabase(
    join(input.currentRoot, 'data', 'workstation.db'),
    join(staging, 'data', 'workstation.db')
  )
  if (dbError) {
    rmSync(staging, { recursive: true, force: true })
    return fail(dbError)
  }

  try {
    // 目标目录刚才可能是空的，改名会失败；先删掉空壳
    if (existsSync(input.targetRoot)) rmSync(input.targetRoot, { recursive: true, force: true })
    renameSync(staging, input.targetRoot)
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    return fail(`落位失败：${error instanceof Error ? error.message : '未知错误'}`)
  }

  // 到这里新位置已可用；位置文件写失败也必须回退，否则下次启动会读旧根却少了数据
  try {
    writeFileSync(
      input.locationFile,
      JSON.stringify(
        { root: input.targetRoot, pending: null, previous: input.currentRoot },
        null,
        2
      ),
      { encoding: 'utf8', mode: 0o600 }
    )
  } catch (error) {
    rmSync(input.targetRoot, { recursive: true, force: true })
    return fail(`写入位置文件失败：${error instanceof Error ? error.message : '未知错误'}`)
  }

  let removedOld = false
  try {
    // 只删上一次确认过的根，且不能是默认目录之外的任意路径
    if (input.location.root === input.currentRoot) {
      rmSync(input.currentRoot, { recursive: true, force: true })
      removedOld = !existsSync(input.currentRoot)
    }
  } catch {
    removedOld = false
  }

  return {
    ok: true,
    root: input.targetRoot,
    error: '',
    removedOld,
    oldRoot: input.currentRoot
  }
}
