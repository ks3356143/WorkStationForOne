import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CapabilityRepository } from '../../db/capabilities'
import { migrate, openDatabase } from '../../db/database'
import {
  applyImportedCodexState,
  copyPluginSnapshot,
  detectComponents,
  importLocal,
  type ImportDeps
} from './local-import'
import { readCodexPluginEnabled } from './codex-config'

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

function seedPluginDir(): string {
  const dir = tempDir('wsfo-plugin-src-')
  mkdirSync(join(dir, 'skills', 'demo'), { recursive: true })
  writeFileSync(join(dir, 'skills', 'demo', 'SKILL.md'), '# demo\n')
  writeFileSync(join(dir, '.mcp.json'), '{}')
  return dir
}

function setup() {
  const base = tempDir('wsfo-import-')
  const db = openDatabase(join(base, 'workstation.db'))
  migrate(db)
  return { base, db, repository: new CapabilityRepository(db) }
}

const scan = {
  agent: 'claude' as const,
  detected: true,
  marketplaces: [
    { name: 'community', source: 'https://github.com/a/b', kind: 'git' as const },
    { name: 'local-only', source: 'D:\\plugins', kind: 'local' as const }
  ],
  plugins: [
    {
      id: 'demo@community',
      name: 'demo',
      market: 'community',
      version: '1.0.0',
      enabled: true,
      installPath: 'D:\\cache\\demo'
    }
  ],
  errors: []
}

describe('importLocal', () => {
  it('注册市场并复制插件，跳过已导入与不存在的项', async () => {
    const { base, db, repository } = setup()
    const realDir = seedPluginDir()
    const withRealPath = {
      ...scan,
      plugins: [{ ...scan.plugins[0], installPath: realDir }]
    }
    const installFromDirectory = vi.fn()
    const registerMarket = vi.fn(async () => undefined)
    const deps: ImportDeps = {
      repository,
      agentDir: base,
      codexHome: join(base, 'codex-home'),
      registerMarket,
      installFromDirectory
    }

    const outcome = await importLocal(
      {
        agent: 'claude',
        markets: ['community', 'missing'],
        plugins: ['demo@community', 'absent@community']
      },
      withRealPath,
      deps
    )

    expect(registerMarket).toHaveBeenCalledWith('community', 'https://github.com/a/b')
    expect(installFromDirectory).toHaveBeenCalledTimes(1)
    expect(outcome.importedMarkets).toEqual(['community'])
    expect(outcome.importedPlugins).toEqual(['demo@community'])
    expect(outcome.skipped.map((item) => item.id)).toEqual(['missing', 'absent@community'])
    db.close()
  })

  it('已存在的插件跳过，不覆盖', async () => {
    const { base, db, repository } = setup()
    repository.upsertPlugin({
      id: 'demo@community',
      name: 'demo',
      description: '',
      version: '0.9.0',
      marketplace: 'community',
      installPath: 'C:\\old',
      components: [],
      hasHooks: false,
      hasMcp: false,
      enabled: false,
      trusted: false,
      agent: 'claude'
    })
    const installFromDirectory = vi.fn()
    const outcome = await importLocal(
      { agent: 'claude', markets: [], plugins: ['demo@community'] },
      scan,
      {
        repository,
        agentDir: base,
        codexHome: join(base, 'codex-home'),
        registerMarket: async () => undefined,
        installFromDirectory
      }
    )
    expect(installFromDirectory).not.toHaveBeenCalled()
    expect(outcome.skipped[0]).toMatchObject({ reason: '已经导入过' })
    db.close()
  })

  it('本机安装目录不存在时跳过并说明原因', async () => {
    const { base, db, repository } = setup()
    const broken = { ...scan, plugins: [{ ...scan.plugins[0], installPath: 'D:\\nope' }] }
    const outcome = await importLocal(
      { agent: 'claude', markets: [], plugins: ['demo@community'] },
      broken,
      {
        repository,
        agentDir: base,
        codexHome: join(base, 'codex-home'),
        registerMarket: async () => undefined,
        installFromDirectory: vi.fn()
      }
    )
    expect(outcome.skipped[0].reason).toContain('不存在')
    db.close()
  })
})

describe('copyPluginSnapshot', () => {
  it('复制到应用私有位置并保留结构', () => {
    const source = seedPluginDir()
    const base = tempDir('wsfo-import-')
    const target = copyPluginSnapshot(
      'claude',
      source,
      { agentDir: base, codexHome: join(base, 'codex-home') },
      {
        id: 'demo@community',
        name: 'demo',
        market: 'community',
        version: '1.0.0',
        enabled: true,
        installPath: source
      }
    )
    expect(existsSync(join(target, 'skills', 'demo', 'SKILL.md'))).toBe(true)
    expect(target).toContain('imported')
  })
})

describe('detectComponents', () => {
  it('识别 skills 与 mcp', () => {
    const dir = seedPluginDir()
    expect(detectComponents(dir)).toEqual({
      components: ['skills', 'mcp'],
      hasHooks: false,
      hasMcp: true
    })
  })
})

describe('applyImportedCodexState', () => {
  it('按本机原状态写入私有 config.toml', () => {
    const home = tempDir('wsfo-codex-import-')
    mkdirSync(home, { recursive: true })
    applyImportedCodexState(home, 'demo', 'community', false)
    const text = readFileSync(join(home, 'config.toml'), 'utf8')
    expect(readCodexPluginEnabled(text, 'demo@community')).toEqual({
      present: true,
      enabled: false
    })
  })
})
