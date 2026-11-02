import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertPrivateCodexHome,
  readCodexPluginEnabled,
  rewritePluginEnabled,
  setCodexPluginEnabled
} from './codex-config'

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

const BASE = [
  'model = "gpt-5"',
  '',
  '[model_providers.workstation]',
  'base_url = "https://example.com"',
  '',
  '[plugins."demo@community"]',
  'enabled = true',
  '',
  '[plugins."other@community"]',
  'enabled = true',
  ''
].join('\n')

describe('rewritePluginEnabled', () => {
  it('只改目标插件的 enabled，其它表原样保留', () => {
    const next = rewritePluginEnabled(BASE, 'demo@community', false)
    expect(readCodexPluginEnabled(next, 'demo@community')).toEqual({
      present: true,
      enabled: false
    })
    expect(readCodexPluginEnabled(next, 'other@community').enabled).toBe(true)
    expect(next).toContain('base_url = "https://example.com"')
    expect(next).toContain('model = "gpt-5"')
  })

  it('表存在但没有 enabled 行时补一行', () => {
    const text = '[plugins."demo@community"]\n'
    const next = rewritePluginEnabled(text, 'demo@community', true)
    expect(next).toContain('enabled = true')
    expect(readCodexPluginEnabled(next, 'demo@community').enabled).toBe(true)
  })

  it('表不存在时追加到末尾，不破坏已有内容', () => {
    const next = rewritePluginEnabled(BASE, 'new@market', true)
    expect(readCodexPluginEnabled(next, 'new@market')).toEqual({ present: true, enabled: true })
    expect(readCodexPluginEnabled(next, 'demo@community').enabled).toBe(true)
    expect(next.startsWith('model = "gpt-5"')).toBe(true)
  })

  it('重复改写结果稳定', () => {
    const once = rewritePluginEnabled(BASE, 'demo@community', false)
    const twice = rewritePluginEnabled(once, 'demo@community', false)
    expect(twice).toBe(once)
  })
})

describe('readCodexPluginEnabled', () => {
  it('缺表视为未安装', () => {
    expect(readCodexPluginEnabled(BASE, 'missing@market')).toEqual({
      present: false,
      enabled: false
    })
  })
})

describe('setCodexPluginEnabled', () => {
  it('写入私有 config.toml 并可读回', () => {
    const home = tempDir('wsfo-codex-')
    writeFileSync(join(home, 'config.toml'), BASE)
    setCodexPluginEnabled(home, 'demo', 'community', false)
    const text = readFileSync(join(home, 'config.toml'), 'utf8')
    expect(readCodexPluginEnabled(text, 'demo@community').enabled).toBe(false)
    expect(text).toContain('[model_providers.workstation]')
  })

  it('config.toml 不存在时创建', () => {
    const home = tempDir('wsfo-codex-')
    mkdirSync(home, { recursive: true })
    setCodexPluginEnabled(home, 'demo', 'community', true)
    const text = readFileSync(join(home, 'config.toml'), 'utf8')
    expect(readCodexPluginEnabled(text, 'demo@community')).toEqual({
      present: true,
      enabled: true
    })
  })
})

describe('assertPrivateCodexHome', () => {
  it('接受应用私有 codex-home', () => {
    expect(() => assertPrivateCodexHome('D:\\app\\codex-home', 'D:\\app')).not.toThrow()
  })

  it('拒绝应用目录之外与用户目录', () => {
    expect(() => assertPrivateCodexHome('C:\\Users\\me\\.codex', 'D:\\app')).toThrow(/之外/)
    expect(() => assertPrivateCodexHome('D:\\app\\other', 'D:\\app')).toThrow(/codex-home/)
  })
})
