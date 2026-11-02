import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  pluginSkillNames,
  removeSyncedSkills,
  syncPluginSkills,
  syncedSkillsOf
} from './codex-skills'

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

function makePlugin(skills: string[]): string {
  const root = tempDir('wsfo-plugin-')
  for (const name of skills) {
    mkdirSync(join(root, 'skills', name), { recursive: true })
    writeFileSync(join(root, 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n`)
  }
  return root
}

describe('pluginSkillNames', () => {
  it('列出插件内的 skill 目录名', () => {
    expect(pluginSkillNames(makePlugin(['alpha', 'beta']))).toEqual(['alpha', 'beta'])
  })

  it('没有 skills 目录时返回空数组', () => {
    expect(pluginSkillNames(tempDir('wsfo-empty-'))).toEqual([])
  })
})

describe('syncPluginSkills', () => {
  it('复制到 CODEX_HOME/skills 并建立来源关系', () => {
    const home = tempDir('wsfo-home-')
    const plugin = makePlugin(['alpha', 'beta'])
    const result = syncPluginSkills({ codexHome: home, pluginRoot: plugin, pluginId: 'p@m' })

    expect(result.synced.sort()).toEqual(['alpha', 'beta'])
    expect(existsSync(join(home, 'skills', 'alpha', 'SKILL.md'))).toBe(true)
    expect(syncedSkillsOf(home, 'p@m').sort()).toEqual(['alpha', 'beta'])
  })

  it('同名 skill 被其他插件占用时覆盖并记录', () => {
    const home = tempDir('wsfo-home-')
    const first = makePlugin(['shared'])
    const second = makePlugin(['shared'])
    writeFileSync(join(second, 'skills', 'shared', 'SKILL.md'), '---\nname: shared\nv: 2\n---\n')

    syncPluginSkills({ codexHome: home, pluginRoot: first, pluginId: 'a@m' })
    const result = syncPluginSkills({ codexHome: home, pluginRoot: second, pluginId: 'b@m' })

    expect(result.removed).toEqual(['shared'])
    expect(syncedSkillsOf(home, 'b@m')).toEqual(['shared'])
    expect(syncedSkillsOf(home, 'a@m')).toEqual([])
    expect(readFileSync(join(home, 'skills', 'shared', 'SKILL.md'), 'utf8')).toContain('v: 2')
  })

  it('重复同步幂等', () => {
    const home = tempDir('wsfo-home-')
    const plugin = makePlugin(['alpha'])
    syncPluginSkills({ codexHome: home, pluginRoot: plugin, pluginId: 'p@m' })
    const again = syncPluginSkills({ codexHome: home, pluginRoot: plugin, pluginId: 'p@m' })
    expect(again.synced).toEqual(['alpha'])
    expect(again.removed).toEqual([])
  })
})

describe('removeSyncedSkills', () => {
  it('只删属于该插件的副本，保留其他目录', () => {
    const home = tempDir('wsfo-home-')
    const a = makePlugin(['alpha'])
    const b = makePlugin(['beta'])
    syncPluginSkills({ codexHome: home, pluginRoot: a, pluginId: 'a@m' })
    syncPluginSkills({ codexHome: home, pluginRoot: b, pluginId: 'b@m' })
    // 手工放入的目录不应被删
    mkdirSync(join(home, 'skills', 'manual'), { recursive: true })

    expect(removeSyncedSkills(home, 'a@m')).toEqual(['alpha'])
    expect(existsSync(join(home, 'skills', 'alpha'))).toBe(false)
    expect(existsSync(join(home, 'skills', 'beta'))).toBe(true)
    expect(existsSync(join(home, 'skills', 'manual'))).toBe(true)
  })
})
