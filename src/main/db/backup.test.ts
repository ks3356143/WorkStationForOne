import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { backupDirFor, backupFileName, listBackups, pruneBackups } from './backup'

const dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wsfo-backup-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('backupFileName', () => {
  it('文件名带本地时间戳且定长', () => {
    const name = backupFileName(new Date(2026, 9, 28, 9, 5, 3))
    expect(name).toBe('workstation-20261028-090503.db')
    expect(name).toHaveLength('workstation-20261028-090503.db'.length)
  })
})

describe('backupDirFor', () => {
  it('Windows 路径也能正确取目录', () => {
    expect(backupDirFor(String.raw`C:\data\workstation.db`)).toBe(String.raw`C:\data\backups`)
    // 应用只跑 Windows，路径语义按 win32；不额外断言 POSIX 行为
  })
})

describe('listBackups / pruneBackups', () => {
  const make = (dir: string, names: string[]) => {
    for (const name of names) writeFileSync(join(dir, name), 'x')
  }

  it('只认备份文件，按时间排序', () => {
    const dir = tempDir()
    make(dir, ['workstation-20261028-090503.db', 'workstation-20261027-090503.db', 'other.txt'])
    expect(listBackups(dir)).toEqual([
      'workstation-20261027-090503.db',
      'workstation-20261028-090503.db'
    ])
  })

  it('超出保留份数时删最旧的', () => {
    const dir = tempDir()
    const names = Array.from({ length: 5 }, (_, index) => `workstation-2026102${index}-090503.db`)
    make(dir, names)
    const removed = pruneBackups(dir, 2)
    expect(removed).toEqual(names.slice(0, 3))
    expect(readdirSync(dir).sort()).toEqual(names.slice(3))
  })

  it('目录不存在时返回空，不抛错', () => {
    expect(listBackups(join(tmpdir(), 'wsfo-not-exist-xyz'))).toEqual([])
  })
})
