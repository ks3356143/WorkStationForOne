import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CapabilityRepository } from '../db/capabilities'
import { migrate, openDatabase } from '../db/database'
import { ClaudePluginService, parsePluginJson } from './claude-plugins'

const STUB = join(process.cwd(), 'scripts', 'stub-plugin-cli.cjs')
const dirs: string[] = []

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'wsfo-plugin-service-'))
  dirs.push(dir)
  const db = openDatabase(join(dir, 'workstation.db'))
  migrate(db)
  return {
    db,
    appData: join(dir, 'data'),
    service: new ClaudePluginService(new CapabilityRepository(db), join(dir, 'data'), {
      bin: process.execPath,
      prefixArgs: [STUB],
      viaNode: true
    })
  }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

describe('Claude CLI JSON 输出', () => {
  it('支持多行 pretty JSON 与前置提示', () => {
    expect(
      parsePluginJson(
        'Refreshing marketplace cache…\n{\n  "available": [\n    { "name": "x" }\n  ]\n}\n'
      )
    ).toEqual({ available: [{ name: 'x' }] })
    expect(parsePluginJson('hint\n[\n  { "id": "demo" }\n]\n')).toEqual([{ id: 'demo' }])
    expect(parsePluginJson('not json')).toBeNull()
  })
})

describe('ClaudePluginService', () => {
  it('从市场安装到应用私有目录，默认停用且可启用', async () => {
    const { db, appData, service } = setup()
    const market = await service.market(true)
    expect(market.entries).toHaveLength(1)
    expect(market.entries[0]).toMatchObject({
      pluginId: 'demo-skill@wsfo-official',
      installed: false
    })

    const installed = await service.install('demo-skill@wsfo-official')
    expect(installed).toMatchObject({
      id: 'demo-skill@wsfo-official',
      name: 'demo-skill',
      version: '1.0.0',
      enabled: false,
      trusted: true,
      components: ['skills']
    })
    expect(service.pluginDirs()).toEqual([])

    const enabled = service.setEnabled(installed.id, true)
    expect(enabled.enabled).toBe(true)
    const dirsFromService = service.pluginDirs()
    expect(dirsFromService).toHaveLength(1)
    expect(dirsFromService[0].startsWith(join(appData, 'agent', 'claude-plugins'))).toBe(true)
    expect(await service.market(false)).toMatchObject({
      entries: [{ pluginId: installed.id, installed: true }]
    })
    db.close()
  })

  it('本地导入裸 SKILL.md，能读取详情并从私有目录移除', async () => {
    const { db, service } = setup()
    const source = join(dirs.at(-1)!, 'My Skill')
    mkdirSync(source, { recursive: true })
    writeFileSync(
      join(source, 'SKILL.md'),
      '---\nname: My Skill\ndescription: local demo\n---\nSay hello.\n'
    )

    const imported = service.importLocal(source)
    expect(imported).toMatchObject({
      name: 'My Skill',
      marketplace: 'local',
      version: 'local',
      enabled: false,
      trusted: true,
      components: ['skills']
    })
    expect(service.pluginDirs()).toEqual([])
    service.setEnabled(imported.id, true)
    const dirsFromService = service.pluginDirs()
    expect(dirsFromService).toHaveLength(1)

    const inspection = service.inspectSkill(imported.id)
    expect(inspection.files).toEqual(
      expect.arrayContaining(['.claude-plugin/plugin.json', 'skills/my-skill/SKILL.md'])
    )
    expect(inspection.docs[0].content).toContain('Say hello.')
    expect(service.folderFor(imported.id)).toBe(dirsFromService[0])

    await service.remove(imported.id)
    expect(service.list()).toEqual([])
    db.close()
  })

  it('更新版本并移除插件', async () => {
    const { db, service } = setup()
    const installed = await service.install('demo-skill@wsfo-official')
    const updated = await service.update(installed.id)
    expect(updated.version).toBe('1.1.0')

    await service.remove(installed.id)
    expect(service.list()).toEqual([])
    db.close()
  })
})
