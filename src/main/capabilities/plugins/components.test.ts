import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectComponents, splitPluginId } from './components'

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

describe('detectComponents', () => {
  it('识别 skills 与 mcp', () => {
    const dir = tempDir('wsfo-plugin-src-')
    mkdirSync(join(dir, 'skills', 'demo'), { recursive: true })
    writeFileSync(join(dir, 'skills', 'demo', 'SKILL.md'), '# demo\n')
    writeFileSync(join(dir, '.mcp.json'), '{}')
    expect(detectComponents(dir)).toEqual({
      components: ['skills', 'mcp'],
      hasHooks: false,
      hasMcp: true
    })
  })

  it('识别 .mcp.jsonc —— 市场安装与本机导入共用同一标准', () => {
    const dir = tempDir('wsfo-plugin-jsonc-')
    writeFileSync(join(dir, '.mcp.jsonc'), '{ /* jsonc */ }')
    expect(detectComponents(dir)).toEqual({ components: ['mcp'], hasHooks: false, hasMcp: true })
  })

  it('hooks 目录与 hooks.json 都算执行组件', () => {
    const dir = tempDir('wsfo-plugin-hooks-')
    mkdirSync(join(dir, 'hooks'), { recursive: true })
    writeFileSync(join(dir, 'hooks', 'hooks.json'), '{}')
    expect(detectComponents(dir)).toEqual({ components: ['hooks'], hasHooks: true, hasMcp: false })
  })

  it('空目录没有任何组件', () => {
    expect(detectComponents(tempDir('wsfo-plugin-empty-'))).toEqual({
      components: [],
      hasHooks: false,
      hasMcp: false
    })
  })
})

describe('splitPluginId', () => {
  it('按最后一个 @ 拆分', () => {
    expect(splitPluginId('demo@community')).toEqual({ name: 'demo', market: 'community' })
  })

  it('没有市场名时市场为空串', () => {
    expect(splitPluginId('local:demo')).toEqual({ name: 'local:demo', market: '' })
  })

  it('名字里带 @ 时只切最后一个', () => {
    expect(splitPluginId('@scope/demo@market')).toEqual({ name: '@scope/demo', market: 'market' })
  })
})
