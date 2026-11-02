import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CapabilityRepository } from '../../db/capabilities'
import { migrate, openDatabase } from '../../db/database'
import { UpdateChecker } from './update-checker'

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

function setup(options: {
  pluginLatestVersion?: string
  installedVersion?: string
  refreshError?: boolean
  mcpLatest?: string
}) {
  const base = tempDir('wsfo-updates-')
  const db = openDatabase(join(base, 'workstation.db'))
  migrate(db)
  const repository = new CapabilityRepository(db)

  // 源目录里放一个带版本号的插件
  const root = join(base, 'agent', 'plugin-sources', 'community')
  mkdirSync(join(root, '.claude-plugin'), { recursive: true })
  writeFileSync(
    join(root, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({
      name: 'community',
      plugins: [{ name: 'demo', source: './plugins/demo' }]
    })
  )
  mkdirSync(join(root, 'plugins', 'demo', '.claude-plugin'), { recursive: true })
  writeFileSync(
    join(root, 'plugins', 'demo', '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'demo', version: options.pluginLatestVersion ?? '1.0.0' })
  )

  repository.createSource({
    id: 'src-1',
    name: 'community',
    kind: 'git',
    url: 'https://github.com/a/b',
    ref: '',
    root
  })
  repository.upsertPlugin({
    id: 'demo@community',
    name: 'demo',
    description: '',
    version: options.installedVersion ?? '1.0.0',
    marketplace: 'community',
    installPath: root,
    components: [],
    hasHooks: false,
    hasMcp: false,
    enabled: true,
    trusted: true,
    agent: 'claude',
    sourceId: 'src-1'
  })

  const onAvailable = vi.fn()
  const checker = new UpdateChecker({
    repository,
    sources: {
      refresh: options.refreshError
        ? async () => {
            throw new Error('源不可达')
          }
        : async (id: string) => {
            const source = repository.findSource(id)!
            return {
              source,
              plugins: [{ name: 'demo', source: './plugins/demo', description: '' }]
            }
          }
    } as unknown as ConstructorParameters<typeof UpdateChecker>[0]['sources'],
    mcp: {
      checkUpdates: async () =>
        options.mcpLatest
          ? [
              {
                id: 'mcp-1',
                name: 'Memory',
                currentVersion: '1.0.0',
                latestVersion: options.mcpLatest,
                hasUpdate: true
              }
            ]
          : []
    } as unknown as ConstructorParameters<typeof UpdateChecker>[0]['mcp'],
    codexHome: join(base, 'codex-home'),
    claudeInstallRoot: () => null,
    onAvailable
  })

  return { base, db, repository, checker, onAvailable }
}

describe('UpdateChecker', () => {
  it('发现插件新版本时回调一次候选列表', async () => {
    const { db, checker, onAvailable } = setup({
      pluginLatestVersion: '1.2.0',
      installedVersion: '1.1.0',
      mcpLatest: '2.0.0'
    })

    const candidates = await checker.check()
    expect(candidates.map((item) => item.kind).sort()).toEqual(['mcp', 'plugin'])
    expect(onAvailable).toHaveBeenCalledTimes(1)
    expect(onAvailable.mock.calls[0][0]).toHaveLength(2)
    db.close()
  })

  it('没有更新时不回调', async () => {
    const { db, checker, onAvailable } = setup({ pluginLatestVersion: '1.0.0' })
    const candidates = await checker.check()
    expect(candidates).toEqual([])
    expect(onAvailable).not.toHaveBeenCalled()
    db.close()
  })

  it('源刷新失败时静默跳过，不影响 MCP 结果', async () => {
    const { db, checker, onAvailable } = setup({
      refreshError: true,
      mcpLatest: '3.0.0'
    })
    const candidates = await checker.check()
    expect(candidates).toHaveLength(1)
    expect(candidates[0].kind).toBe('mcp')
    expect(onAvailable).toHaveBeenCalledTimes(1)
    db.close()
  })

  it('并发调用时只跑一次', async () => {
    const { db, checker } = setup({ pluginLatestVersion: '2.0.0' })
    const [first, second] = await Promise.all([checker.check(), checker.check()])
    expect(first.length + second.length).toBe(1)
    db.close()
  })
})
