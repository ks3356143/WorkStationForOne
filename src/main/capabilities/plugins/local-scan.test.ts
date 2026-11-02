import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { scanClaudeLocal, scanCodexLocal } from './local-scan'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

function tempHome(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wsfo-scan-'))
  dirs.push(dir)
  return dir
}

/** 记录文件内容与 mtime，用来断言扫描不改任何东西。 */
function snapshot(files: string[]): string {
  const hash = createHash('sha256')
  for (const file of files) {
    try {
      hash.update(file)
      hash.update(readFileSync(file))
    } catch {
      hash.update('missing')
    }
  }
  return hash.digest('hex')
}

function seedClaude(root: string): string[] {
  const base = join(root, '.claude', 'plugins')
  mkdirSync(join(base, 'cache', 'karpathy-skills', 'demo', '1.0.0'), { recursive: true })
  const known = join(base, 'known_marketplaces.json')
  const installed = join(base, 'installed_plugins.json')
  writeFileSync(
    known,
    JSON.stringify({
      'karpathy-skills': {
        source: { source: 'github', repo: 'forrestchang/andrej-karpathy-skills' },
        installLocation: join(base, 'marketplaces', 'karpathy-skills')
      },
      'local-market': {
        source: { source: 'directory', path: 'D:\\plugins\\local' },
        installLocation: 'D:\\plugins\\local'
      }
    })
  )
  writeFileSync(
    installed,
    JSON.stringify({
      version: 2,
      plugins: {
        'demo@karpathy-skills': [
          {
            scope: 'user',
            installPath: join(base, 'cache', 'karpathy-skills', 'demo', '1.0.0'),
            version: '1.0.0'
          }
        ]
      }
    })
  )
  return [known, installed]
}

function seedCodex(root: string): string[] {
  const base = join(root, '.codex')
  mkdirSync(join(base, 'plugins', 'cache', 'openai-bundled', 'pdf', '2.0.1'), {
    recursive: true
  })
  const config = join(base, 'config.toml')
  writeFileSync(
    config,
    [
      'model = "gpt-5"',
      '',
      '[marketplaces.openai-bundled]',
      'source_type = "local"',
      "source = '\\\\?\\C:\\Users\\me\\.codex\\.tmp\\bundled-marketplaces\\openai-bundled'",
      '',
      '[marketplaces.remote]',
      'source_type = "git"',
      'source = "https://github.com/example/plugins.git"',
      '',
      '[plugins."pdf@openai-bundled"]',
      'enabled = true',
      '',
      '[plugins."spreadsheets@openai-bundled"]',
      'enabled = false',
      ''
    ].join('\n')
  )
  return [config]
}

describe('scanClaudeLocal', () => {
  it('解析市场与已装插件，Git 与本地目录分别标注', () => {
    const root = tempHome()
    seedClaude(root)
    const result = scanClaudeLocal(root)

    expect(result.detected).toBe(true)
    expect(result.marketplaces).toEqual([
      {
        name: 'karpathy-skills',
        source: 'https://github.com/forrestchang/andrej-karpathy-skills',
        kind: 'git'
      },
      { name: 'local-market', source: 'D:\\plugins\\local', kind: 'local' }
    ])
    expect(result.plugins).toEqual([
      {
        id: 'demo@karpathy-skills',
        name: 'demo',
        market: 'karpathy-skills',
        version: '1.0.0',
        enabled: true,
        installPath: expect.stringContaining('cache')
      }
    ])
    expect(result.errors).toEqual([])
  })

  it('没有本机配置时标记未检测到', () => {
    const result = scanClaudeLocal(tempHome())
    expect(result.detected).toBe(false)
    expect(result.marketplaces).toEqual([])
  })

  it('损坏的 JSON 只记错误，不抛出', () => {
    const root = tempHome()
    const base = join(root, '.claude', 'plugins')
    mkdirSync(base, { recursive: true })
    writeFileSync(join(base, 'known_marketplaces.json'), '{')
    const result = scanClaudeLocal(root)
    expect(result.detected).toBe(true)
    expect(result.errors[0]).toContain('known_marketplaces')
  })

  it('扫描前后文件内容不变', () => {
    const root = tempHome()
    const files = seedClaude(root)
    const before = snapshot(files)
    scanClaudeLocal(root)
    expect(snapshot(files)).toBe(before)
  })
})

describe('scanCodexLocal', () => {
  it('解析市场表与插件表，去掉本地源的长路径前缀', () => {
    const root = tempHome()
    seedCodex(root)
    const result = scanCodexLocal(root)

    expect(result.detected).toBe(true)
    expect(result.marketplaces).toEqual([
      {
        name: 'openai-bundled',
        source: 'C:\\Users\\me\\.codex\\.tmp\\bundled-marketplaces\\openai-bundled',
        kind: 'local'
      },
      { name: 'remote', source: 'https://github.com/example/plugins.git', kind: 'git' }
    ])

    const pdf = result.plugins.find((plugin) => plugin.id === 'pdf@openai-bundled')
    expect(pdf).toMatchObject({ name: 'pdf', market: 'openai-bundled', enabled: true })
    expect(pdf?.version).toBe('2.0.1')
    expect(
      result.plugins.find((plugin) => plugin.id === 'spreadsheets@openai-bundled')?.enabled
    ).toBe(false)
  })

  it('没有本机配置时标记未检测到', () => {
    expect(scanCodexLocal(tempHome()).detected).toBe(false)
  })

  it('扫描前后 config.toml 不变', () => {
    const root = tempHome()
    const files = seedCodex(root)
    const before = snapshot(files)
    scanCodexLocal(root)
    expect(snapshot(files)).toBe(before)
  })
})
