import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_APP_DIR,
  describeLayout,
  readLocation,
  resolveAppRoot,
  resolveLayout,
  validateTargetRoot,
  writeLocation
} from './location'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

describe('resolveLayout', () => {
  it('按根目录派生数据库、备份、插件与 codex-home', () => {
    const layout = resolveLayout('D:\\WorkStationForOne')
    expect(layout.root).toBe('D:\\WorkStationForOne')
    expect(layout.dataDir).toBe(join('D:\\WorkStationForOne', 'data'))
    expect(layout.dbFile).toBe(join('D:\\WorkStationForOne', 'data', 'workstation.db'))
    expect(layout.backupDir).toBe(join('D:\\WorkStationForOne', 'data', 'backups'))
    expect(layout.agentDir).toBe(join('D:\\WorkStationForOne', 'agent'))
    expect(layout.codexHome).toBe(join('D:\\WorkStationForOne', 'codex-home'))
  })

  it('默认根目录是 appData 下的应用目录', () => {
    expect(DEFAULT_APP_DIR).toContain('WorkStationForOne')
    expect(isAbsolute(resolveLayout('C:\\x').root)).toBe(true)
  })
})

describe('readLocation / writeLocation', () => {
  it('文件不存在时返回默认值与空 pending', () => {
    const dir = makeTempDir()
    const state = readLocation(join(dir, 'location.json'))
    expect(state.root).toBe('')
    expect(state.pending).toBeNull()
    expect(state.error).toBe('')
  })

  it('写入后能读回 root 与 pending', () => {
    const dir = makeTempDir()
    const file = join(dir, 'location.json')
    writeLocation(file, { root: 'D:\\WSFO', pending: null, previous: 'C:\\old' })
    const state = readLocation(file)
    expect(state.root).toBe('D:\\WSFO')
    expect(state.previous).toBe('C:\\old')
  })

  it('损坏的 JSON 回退默认值并给出原因', () => {
    const dir = makeTempDir()
    const file = join(dir, 'location.json')
    writeFileSync(file, '{ not json')
    const state = readLocation(file)
    expect(state.root).toBe('')
    expect(state.error).toContain('无法解析')
  })
})

describe('resolveAppRoot', () => {
  it('WS_DATA_DIR 优先于位置文件', () => {
    const dir = makeTempDir()
    const file = join(dir, 'location.json')
    writeLocation(file, { root: 'D:\\from-file', pending: null, previous: null })
    const resolved = resolveAppRoot({
      locationFile: file,
      envDataDir: 'E:\\root\\data',
      fallbackRoot: 'C:\\app'
    })
    // WS_DATA_DIR 历来指 data 目录，根取它的父级
    expect(resolved.root).toBe('E:\\root')
    expect(resolved.source).toBe('env')
  })

  it('没有环境变量时用位置文件，没有位置文件时用默认根', () => {
    const dir = makeTempDir()
    const file = join(dir, 'location.json')
    writeLocation(file, { root: 'D:\\from-file', pending: null, previous: null })
    expect(resolveAppRoot({ locationFile: file, fallbackRoot: 'C:\\app' }).source).toBe('file')

    const missing = join(dir, 'nope.json')
    const resolved = resolveAppRoot({ locationFile: missing, fallbackRoot: 'C:\\app' })
    expect(resolved.root).toBe('C:\\app')
    expect(resolved.source).toBe('default')
  })
})

describe('validateTargetRoot', () => {
  const current = 'C:\\Users\\me\\AppData\\Roaming\\WorkStationForOne'

  it('拒绝相对路径、当前目录、父子目录', () => {
    expect(validateTargetRoot('relative\\path', current)).toContain('绝对路径')
    expect(validateTargetRoot(current, current)).toContain('相同')
    expect(validateTargetRoot(join(current, 'sub'), current)).toContain('子目录')
    expect(validateTargetRoot('C:\\Users\\me\\AppData\\Roaming', current)).toContain('父目录')
  })

  it('接受同盘不同目录', () => {
    expect(validateTargetRoot('D:\\WorkStationForOne', current)).toBe('')
  })
})

describe('describeLayout', () => {
  it('按固定顺序列出根目录下的子目录', () => {
    const lines = describeLayout(resolveLayout('D:\\WSFO'))
    expect(lines).toEqual(['data', 'agent', 'codex-home'])
  })
})

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wsfo-location-'))
  dirs.push(dir)
  return dir
}
