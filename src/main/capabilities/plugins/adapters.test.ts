import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { StoredPlugin } from '../../db/capabilities'
import { compareVersion, listCodexInstalled, reconcile } from './adapters'

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

function seedCodexHome(): string {
  const home = tempDir('wsfo-codex-adapters-')
  mkdirSync(join(home, 'plugins', 'cache', 'community', 'demo', '1.2.0'), { recursive: true })
  mkdirSync(join(home, 'plugins', 'cache', 'community', 'demo', '1.10.0'), { recursive: true })
  mkdirSync(join(home, 'plugins', 'cache', 'other', 'tool', '0.1.0'), { recursive: true })
  writeFileSync(
    join(home, 'config.toml'),
    [
      '[plugins."demo@community"]',
      'enabled = true',
      '',
      '[plugins."tool@other"]',
      'enabled = false',
      ''
    ].join('\n')
  )
  return home
}

function storedPlugin(over: Partial<StoredPlugin> = {}): StoredPlugin {
  return {
    id: 'demo@community',
    name: 'demo',
    description: '',
    version: '1.2.0',
    marketplace: 'community',
    enabled: true,
    trusted: true,
    components: ['skills'],
    hasHooks: false,
    hasMcp: false,
    agent: 'codex',
    sourceId: 'src-1',
    installedAt: 1,
    updatedAt: 1,
    installPath: 'C:\\codex\\demo',
    ...over
  }
}

describe('compareVersion', () => {
  it('按数字段比较，1.10.0 高于 1.9.0', () => {
    expect(compareVersion('1.10.0', '1.9.0')).toBeGreaterThan(0)
    expect(compareVersion('2.0.0', '1.99.99')).toBeGreaterThan(0)
    expect(compareVersion('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersion('1.0', '1.0.1')).toBeLessThan(0)
  })
})

describe('listCodexInstalled', () => {
  it('从 cache 目录读版本与路径，从 config.toml 读启停', () => {
    const home = seedCodexHome()
    const installed = listCodexInstalled(home)
    const demo = installed.find((plugin) => plugin.id === 'demo@community')
    expect(demo).toMatchObject({ name: 'demo', market: 'community', enabled: true })
    expect(demo?.version).toBe('1.10.0')
    expect(demo?.installPath).toContain('1.10.0')
    expect(installed.find((plugin) => plugin.id === 'tool@other')?.enabled).toBe(false)
  })

  it('没有缓存目录时返回空数组', () => {
    const home = tempDir('wsfo-codex-empty-')
    expect(listCodexInstalled(home)).toEqual([])
  })
})

describe('reconcile', () => {
  it('库里与磁盘都有的取磁盘版本，磁盘缺失的标记', () => {
    const home = seedCodexHome()
    const installed = listCodexInstalled(home)
    const merged = reconcile(
      [storedPlugin(), storedPlugin({ id: 'gone@community', name: 'gone' })],
      installed,
      'codex'
    )

    const demo = merged.find((plugin) => plugin.id === 'demo@community')
    expect(demo).toMatchObject({ version: '1.10.0', inDb: true, missingOnDisk: false })

    const gone = merged.find((plugin) => plugin.id === 'gone@community')
    expect(gone).toMatchObject({ missingOnDisk: true, trusted: true })

    const added = merged.find((plugin) => plugin.id === 'tool@other')
    expect(added).toMatchObject({ inDb: false, trusted: false })
  })

  it('只合并目标 Agent 的记录', () => {
    const merged = reconcile([storedPlugin({ agent: 'claude' })], [], 'codex')
    expect(merged).toEqual([])
  })
})
