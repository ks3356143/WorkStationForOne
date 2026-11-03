import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { backupEntries, createBackup, listBackups } from './backup'
import { MIGRATIONS, migrate, openDatabase } from './database'
import { applyPendingRestore, inspectBackup, readRestoreState, requestRestore } from './restore'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wsfo-restore-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function makeDb(file: string, marker: string): void {
  const db = openDatabase(file)
  migrate(db)
  db.exec('CREATE TABLE IF NOT EXISTS marker (value TEXT)')
  db.prepare('INSERT INTO marker (value) VALUES (?)').run(marker)
  db.close()
}

function markerOf(file: string): string {
  const db = openDatabase(file)
  try {
    const row = db.prepare('SELECT value FROM marker').get() as { value: string } | undefined
    return row?.value ?? ''
  } finally {
    db.close()
  }
}

function makeBackup(dataDir: string, marker: string): { backupDir: string; name: string } {
  const backupDir = join(dataDir, 'backups')
  mkdirSync(backupDir, { recursive: true })
  const source = join(dataDir, `source-${marker}.db`)
  makeDb(source, marker)
  const db = openDatabase(source)
  try {
    const file = createBackup(db, backupDir)
    return { backupDir, name: basename(file) }
  } finally {
    db.close()
    rmSync(source, { force: true })
    rmSync(`${source}-wal`, { force: true })
    rmSync(`${source}-shm`, { force: true })
  }
}

describe('backupEntries', () => {
  it('只列可恢复文件，按修改时间倒序并标记快照', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'workstation-20261028-090503.db'), 'a')
    writeFileSync(join(dir, 'workstation-20261029-090503-pre.db'), 'bb')
    writeFileSync(join(dir, 'other.txt'), 'x')
    utimesSync(join(dir, 'workstation-20261028-090503.db'), new Date(1_000), new Date(1_000))
    utimesSync(join(dir, 'workstation-20261029-090503-pre.db'), new Date(2_000), new Date(2_000))

    const entries = backupEntries(dir)
    expect(entries.map((entry) => entry.name)).toEqual([
      'workstation-20261029-090503-pre.db',
      'workstation-20261028-090503.db'
    ])
    expect(entries[0]).toMatchObject({ safety: true, bytes: 2 })
    expect(entries[1]).toMatchObject({ safety: false, bytes: 1 })
  })

  it('不存在的目录返回空', () => {
    expect(backupEntries(join(tmpdir(), 'wsfo-no-backup-xyz'))).toEqual([])
  })
})

describe('inspectBackup', () => {
  it('接受应用自己的备份并返回版本', () => {
    const dir = tempDir()
    const { backupDir, name } = makeBackup(dir, 'restored')
    expect(inspectBackup(join(backupDir, name))).toEqual({
      userVersion: MIGRATIONS.at(-1)?.version
    })
  })

  it('拒绝损坏文件、更新版本和缺少任务表的库', () => {
    const dir = tempDir()
    const corrupt = join(dir, 'workstation-20261028-090503.db')
    writeFileSync(corrupt, 'not a database')
    expect(() => inspectBackup(corrupt)).toThrow(/不是有效的数据库/)

    const future = join(dir, 'workstation-20300101-000000.db')
    const futureDb = openDatabase(future)
    futureDb.exec('PRAGMA user_version = 999')
    futureDb.close()
    expect(() => inspectBackup(future)).toThrow(/更新版本/)

    const empty = join(dir, 'workstation-20261028-100000.db')
    const emptyDb = openDatabase(empty)
    emptyDb.exec('PRAGMA user_version = 1')
    emptyDb.close()
    expect(() => inspectBackup(empty)).toThrow(/缺少任务表/)
  })
})

describe('requestRestore', () => {
  it('校验备份、留安全快照并写入待恢复状态', () => {
    const dir = tempDir()
    const dbFile = join(dir, 'workstation.db')
    makeDb(dbFile, 'current')
    const backup = makeBackup(dir, 'restored')
    const db = openDatabase(dbFile)
    try {
      const result = requestRestore({
        db,
        backupDir: backup.backupDir,
        dataDir: dir,
        name: backup.name
      })
      expect(result.backup).toBe(backup.name)
      expect(existsSync(join(backup.backupDir, result.safety))).toBe(true)
      expect(readRestoreState(dir)).toMatchObject({
        status: 'pending',
        backup: backup.name,
        safety: result.safety
      })
      expect(listBackups(backup.backupDir)).toContain(result.safety)
    } finally {
      db.close()
    }
  })

  it('拒绝路径穿越、损坏备份与已有待恢复', () => {
    const dir = tempDir()
    const dbFile = join(dir, 'workstation.db')
    makeDb(dbFile, 'current')
    const backup = makeBackup(dir, 'restored')
    const db = openDatabase(dbFile)
    try {
      expect(() =>
        requestRestore({ db, backupDir: backup.backupDir, dataDir: dir, name: '../evil.db' })
      ).toThrow(/文件名无效/)

      const corrupt = join(backup.backupDir, 'workstation-20300101-000000.db')
      writeFileSync(corrupt, 'not a database')
      expect(() =>
        requestRestore({
          db,
          backupDir: backup.backupDir,
          dataDir: dir,
          name: 'workstation-20300101-000000.db'
        })
      ).toThrow(/不是有效的数据库/)

      const first = requestRestore({
        db,
        backupDir: backup.backupDir,
        dataDir: dir,
        name: backup.name
      })
      expect(first.backup).toBe(backup.name)
      expect(() =>
        requestRestore({ db, backupDir: backup.backupDir, dataDir: dir, name: backup.name })
      ).toThrow(/等待重启/)
    } finally {
      db.close()
    }
  })
})

describe('applyPendingRestore', () => {
  it('开库前替换数据库并标记 applied', () => {
    const dir = tempDir()
    const dbFile = join(dir, 'workstation.db')
    makeDb(dbFile, 'current')
    const backup = makeBackup(dir, 'restored')
    const db = openDatabase(dbFile)
    try {
      requestRestore({ db, backupDir: backup.backupDir, dataDir: dir, name: backup.name })
    } finally {
      db.close()
    }

    const result = applyPendingRestore({
      dbFile,
      dataDir: dir,
      backupDir: backup.backupDir
    })
    expect(result).toMatchObject({ applied: true, backup: backup.name })
    expect(markerOf(dbFile)).toBe('restored')
    expect(readRestoreState(dir)).toMatchObject({ status: 'applied', backup: backup.name })
  })

  it('备份损坏时保持当前库并记录失败', () => {
    const dir = tempDir()
    const dbFile = join(dir, 'workstation.db')
    makeDb(dbFile, 'current')
    const backupDir = join(dir, 'backups')
    mkdirSync(backupDir, { recursive: true })
    writeFileSync(join(backupDir, 'workstation-20300101-000000.db'), 'not a database')
    writeFileSync(
      join(dir, 'restore.json'),
      JSON.stringify({
        status: 'pending',
        backup: 'workstation-20300101-000000.db',
        at: Date.now(),
        error: '',
        safety: '',
        pre: ''
      })
    )

    const result = applyPendingRestore({ dbFile, dataDir: dir, backupDir })
    expect(result.applied).toBe(false)
    expect(result.error).toMatch(/不是有效的数据库/)
    expect(markerOf(dbFile)).toBe('current')
    expect(readRestoreState(dir)).toMatchObject({ status: 'failed' })
  })

  it('上次替换中断时用 pre 文件回滚', () => {
    const dir = tempDir()
    const dbFile = join(dir, 'workstation.db')
    makeDb(dbFile, 'current')
    const backup = makeBackup(dir, 'restored')
    const pre = `${dbFile}.pre-restore-1`
    copyFileSync(dbFile, pre)
    copyFileSync(join(backup.backupDir, backup.name), dbFile)
    writeFileSync(
      join(dir, 'restore.json'),
      JSON.stringify({
        status: 'applying',
        backup: backup.name,
        at: Date.now(),
        error: '',
        safety: '',
        pre
      })
    )

    const result = applyPendingRestore({
      dbFile,
      dataDir: dir,
      backupDir: backup.backupDir
    })
    expect(result.applied).toBe(false)
    expect(result.error).toMatch(/已回滚/)
    expect(markerOf(dbFile)).toBe('current')
    expect(readRestoreState(dir)).toMatchObject({ status: 'failed' })
    expect(existsSync(pre)).toBe(false)
  })

  it('没有待恢复记录时不动数据库', () => {
    const dir = tempDir()
    const dbFile = join(dir, 'workstation.db')
    makeDb(dbFile, 'current')
    const before = readFileSync(dbFile)
    const result = applyPendingRestore({ dbFile, dataDir: dir, backupDir: join(dir, 'backups') })
    expect(result.applied).toBe(false)
    expect(readFileSync(dbFile).equals(before)).toBe(true)
  })
})
