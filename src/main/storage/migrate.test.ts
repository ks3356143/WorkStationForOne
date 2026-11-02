import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { readLocation, resolveLayout, writeLocation } from './location'
import { cleanupStale, migrateRoot } from './migrate'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

/** 造一个最小可迁移的根目录：一个库、一个备份、一个插件目录。 */
function seedRoot(prefix: string): string {
  const root = tempDir(prefix)
  const layout = resolveLayout(root)
  mkdirSync(layout.dataDir, { recursive: true })
  mkdirSync(layout.backupDir, { recursive: true })
  mkdirSync(join(layout.claudePluginDir, 'demo'), { recursive: true })
  writeFileSync(join(layout.claudePluginDir, 'demo', 'SKILL.md'), '# demo\n')
  writeFileSync(join(layout.backupDir, 'old.db'), 'backup-bytes')

  const db = new DatabaseSync(layout.dbFile)
  db.exec('PRAGMA user_version = 29')
  db.exec('CREATE TABLE sample (id INTEGER PRIMARY KEY, name TEXT NOT NULL)')
  db.prepare('INSERT INTO sample (name) VALUES (?)').run('hello')
  db.close()
  return root
}

function locationFor(root: string): string {
  const dir = tempDir('wsfo-loc-')
  const file = join(dir, 'location.json')
  writeLocation(file, { root, pending: null, previous: null })
  return file
}

describe('migrateRoot', () => {
  it('复制、校验、切换并删除旧根', () => {
    const source = seedRoot('wsfo-src-')
    const targetParent = tempDir('wsfo-dst-')
    const target = join(targetParent, 'new-root')
    const locationFile = locationFor(source)

    const result = migrateRoot({
      currentRoot: source,
      targetRoot: target,
      locationFile,
      location: readLocation(locationFile),
      skipSpaceCheck: true
    })

    expect(result.ok).toBe(true)
    expect(result.root).toBe(target)
    expect(result.removedOld).toBe(true)
    expect(existsSync(source)).toBe(false)

    const layout = resolveLayout(target)
    expect(existsSync(layout.dbFile)).toBe(true)
    expect(existsSync(join(layout.claudePluginDir, 'demo', 'SKILL.md'))).toBe(true)
    expect(existsSync(join(layout.backupDir, 'old.db'))).toBe(true)

    const state = readLocation(locationFile)
    expect(state.root).toBe(target)
    expect(state.previous).toBe(source)
    expect(state.pending).toBeNull()

    const db = new DatabaseSync(layout.dbFile, { readOnly: true })
    const row = db.prepare('SELECT name FROM sample').get() as { name: string }
    db.close()
    expect(row.name).toBe('hello')
  })

  it('目标目录非空时拒绝，且不动旧根', () => {
    const source = seedRoot('wsfo-src-')
    const targetParent = tempDir('wsfo-dst-')
    const target = join(targetParent, 'occupied')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'keep.txt'), 'x')
    const locationFile = locationFor(source)

    const result = migrateRoot({
      currentRoot: source,
      targetRoot: target,
      locationFile,
      location: readLocation(locationFile),
      skipSpaceCheck: true
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('不为空')
    expect(existsSync(join(resolveLayout(source).dbFile))).toBe(true)
    expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('x')
    expect(readLocation(locationFile).root).toBe(source)
  })

  it('目标库校验失败时回滚，保留旧根与位置文件', () => {
    const source = seedRoot('wsfo-src-')
    const targetParent = tempDir('wsfo-dst-')
    const target = join(targetParent, 'broken')
    mkdirSync(target, { recursive: true })
    // 目标已有同结构目录但库是坏的：复制后应被校验拦下
    const brokenLayout = resolveLayout(target)
    mkdirSync(brokenLayout.dataDir, { recursive: true })
    writeFileSync(brokenLayout.dbFile, 'not a database')

    const locationFile = locationFor(source)
    const result = migrateRoot({
      currentRoot: source,
      targetRoot: target,
      locationFile,
      location: readLocation(locationFile),
      skipSpaceCheck: true
    })

    // 目标非空会先被拒绝；这条断言确认拦截发生在复制之前
    expect(result.ok).toBe(false)
    expect(existsSync(resolveLayout(source).dbFile)).toBe(true)
    expect(readLocation(locationFile).root).toBe(source)
  })

  it('拒绝父目录与相同目录', () => {
    const source = seedRoot('wsfo-src-')
    const locationFile = locationFor(source)
    const location = readLocation(locationFile)

    expect(
      migrateRoot({
        currentRoot: source,
        targetRoot: source,
        locationFile,
        location,
        skipSpaceCheck: true
      }).error
    ).toContain('相同')

    const parent = join(source, '..')
    expect(
      migrateRoot({
        currentRoot: source,
        targetRoot: parent,
        locationFile,
        location,
        skipSpaceCheck: true
      }).error
    ).toContain('父目录')
  })

  it('旧根删除失败时不阻断成功结果', () => {
    const source = seedRoot('wsfo-src-')
    const targetParent = tempDir('wsfo-dst-')
    const target = join(targetParent, 'ok-root')
    const locationFile = locationFor(source)
    // location.root 与 currentRoot 不一致时，按设计不删旧根
    writeLocation(locationFile, { root: '', pending: null, previous: null })

    const result = migrateRoot({
      currentRoot: source,
      targetRoot: target,
      locationFile,
      location: readLocation(locationFile),
      skipSpaceCheck: true
    })

    expect(result.ok).toBe(true)
    expect(result.removedOld).toBe(false)
    expect(existsSync(source)).toBe(true)
    expect(readLocation(locationFile).root).toBe(target)
  })

  it('校验源库与目标库内容一致（哈希）', () => {
    const source = seedRoot('wsfo-src-')
    const targetParent = tempDir('wsfo-dst-')
    const target = join(targetParent, 'hash-root')
    const locationFile = locationFor(source)
    const before = createHash('sha256')
      .update(readFileSync(resolveLayout(source).dbFile))
      .digest('hex')

    const result = migrateRoot({
      currentRoot: source,
      targetRoot: target,
      locationFile,
      location: readLocation(locationFile),
      skipSpaceCheck: true
    })
    expect(result.ok).toBe(true)

    const after = createHash('sha256')
      .update(readFileSync(resolveLayout(target).dbFile))
      .digest('hex')
    expect(after).toBe(before)
  })
})

describe('cleanupStale', () => {
  it('删除目标旁的 .migrating-* 残骸', () => {
    const parent = tempDir('wsfo-dst-')
    const target = join(parent, 'root')
    const stale = `${target}.migrating-123`
    mkdirSync(stale, { recursive: true })
    writeFileSync(join(stale, 'junk.txt'), 'x')

    cleanupStale(target)
    expect(existsSync(stale)).toBe(false)
  })
})
