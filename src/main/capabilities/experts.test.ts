import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { BUILTIN_EXPERTS } from '../../shared/experts'
import { migrate, openDatabase } from '../db/database'
import { ExpertRepository } from '../db/experts'
import { ExpertMarketService, scanExpertDir } from './expert-market'
import { ExpertService, type ExpertServiceDeps } from './experts'

const dirs: string[] = []
const dbs: DatabaseSync[] = []
function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}
function seedRepo(): ExpertRepository {
  const db = openDatabase(join(tempDir('wsfo-expert-svc-'), 'workstation.db'))
  dbs.push(db)
  migrate(db)
  return new ExpertRepository(db)
}
const md = (name: string, body = '人设正文'): string =>
  `---\nname: ${name}\ndescription: 描述\nmcp: [context7]\n---\n${body}\n`

afterEach(() => {
  while (dbs.length) dbs.pop()!.close()
  while (dirs.length)
    rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

function service(repo: ExpertRepository, overrides: Partial<ExpertServiceDeps> = {}) {
  const calls = { mcp: [] as string[], skill: [] as string[], preferred: [] as string[] }
  const deps: ExpertServiceDeps = {
    repository: repo,
    trustedMcpIds: () => ['context7'],
    installedSkillIds: () => ['document-skills'],
    enableMcp: (id) => calls.mcp.push(id),
    enableSkill: (id) => calls.skill.push(id),
    setPreferred: (_agent, key) => calls.preferred.push(key),
    writeExport: async (name) => ({ canceled: false, path: `/tmp/${name}`, count: 1 }),
    ...overrides
  }
  return { svc: new ExpertService(deps), calls }
}

describe('ExpertService', () => {
  it('list 合并内置与自定义', () => {
    const repo = seedRepo()
    repo.saveExpert({ name: '自定义', description: '', persona: 'p', tools: [] })
    const { svc } = service(repo)
    const list = svc.list()
    expect(list.filter((e) => e.builtin).map((e) => e.id)).toEqual(BUILTIN_EXPERTS.map((e) => e.id))
    expect(list.some((e) => !e.builtin && e.name === '自定义')).toBe(true)
  })

  it('内置不可删除', () => {
    const { svc } = service(seedRepo())
    expect(svc.remove('frontend')).toBe(false)
  })

  it('importMarkdown 无效文本抛错', () => {
    const { svc } = service(seedRepo())
    expect(() => svc.importMarkdown('没有 frontmatter')).toThrow()
  })

  it('importMarkdown 与内置 id 冲突加后缀，自定义同 id 更新', () => {
    const repo = seedRepo()
    const { svc } = service(repo)
    const a = svc.importMarkdown(md('frontend'))
    expect(a.id).toBe('frontend-2')
    expect(a.builtin).toBe(false)
    const b = svc.importMarkdown(md('frontend', '改后的人设'))
    expect(b.id).toBe('frontend-2')
    expect(b.persona).toBe('改后的人设')
    expect(repo.listExperts().length).toBe(1)
  })

  it('export 序列化并交给 writeExport', async () => {
    const repo = seedRepo()
    const saved = repo.saveExpert({
      name: '导出',
      description: 'd',
      persona: '正文',
      tools: ['mcp:context7']
    })
    let captured = { name: '', content: '' }
    const { svc } = service(repo, {
      writeExport: async (name, content) => {
        captured = { name, content }
        return { canceled: false, path: `/tmp/${name}`, count: 1 }
      }
    })
    const result = await svc.export(saved.id)
    expect(result.canceled).toBe(false)
    expect(captured.name).toBe(`${saved.id}.md`)
    expect(captured.content).toContain(`name: ${saved.id}`)
    expect(captured.content).toContain('正文')
  })

  it('activate 只启用已信任 MCP 与已装技能并设★', () => {
    const { svc, calls } = service(seedRepo())
    const result = svc.activate('claude', 'office')
    expect(result.applied).toEqual(['skill:document-skills'])
    expect(result.missing).toEqual([])
    expect(calls.skill).toEqual(['document-skills'])
    expect(calls.preferred).toEqual(['skill:document-skills'])
  })

  it('activate 未信任 MCP 与未装技能进 missing', () => {
    const { svc, calls } = service(seedRepo())
    const result = svc.activate('claude', 'frontend')
    expect(result.applied).toEqual(['mcp:context7'])
    expect(result.missing).toEqual(['mcp:deepwiki', 'skill:frontend-design'])
    expect(calls.mcp).toEqual(['context7'])
  })

  it('activate 单条启用失败不阻断，汇总进 missing', () => {
    const { svc } = service(seedRepo(), {
      enableMcp: () => {
        throw new Error('boom')
      }
    })
    const result = svc.activate('claude', 'frontend')
    expect(result.applied).toEqual([])
    expect(result.missing).toContain('mcp:context7')
  })
})

describe('scanExpertDir', () => {
  it('限深限量、跳过 node_modules、解析失败计数', () => {
    const root = tempDir('wsfo-scan-')
    writeFileSync(join(root, 'a.md'), md('a'))
    writeFileSync(join(root, 'bad.md'), '无 frontmatter')
    mkdirSync(join(root, 'sub'))
    writeFileSync(join(root, 'sub', 'c.md'), md('c'))
    mkdirSync(join(root, 'node_modules'))
    writeFileSync(join(root, 'node_modules', 'd.md'), md('d'))
    const { entries, skipped } = scanExpertDir(root)
    expect(entries.map((e) => e.id).sort()).toEqual(['a', 'c'])
    expect(skipped).toBe(1)
    expect(entries.find((e) => e.id === 'c')?.relPath).toBe('sub/c.md')
  })

  it('超过限量停止收集', () => {
    const root = tempDir('wsfo-scan-limit-')
    for (let i = 0; i < 5; i += 1) writeFileSync(join(root, `e${i}.md`), md(`e${i}`))
    const { entries } = scanExpertDir(root, 3)
    expect(entries.length).toBe(3)
  })
})

describe('ExpertMarketService', () => {
  function market(repo: ExpertRepository) {
    const appData = tempDir('wsfo-market-')
    const svc = new ExpertService({
      repository: repo,
      trustedMcpIds: () => [],
      installedSkillIds: () => [],
      enableMcp: () => undefined,
      enableSkill: () => undefined,
      setPreferred: () => undefined,
      writeExport: async () => ({ canceled: true })
    })
    const mkt = new ExpertMarketService({
      repository: repo,
      appDataDir: appData,
      importMarkdown: (text) => svc.importMarkdown(text)
    })
    return { mkt, appData }
  }

  it('本地源添加 / 浏览 / 导入落库', async () => {
    const repo = seedRepo()
    const { mkt } = market(repo)
    const src = tempDir('wsfo-src-')
    writeFileSync(join(src, 'rev.md'), md('reviewer'))
    const source = await mkt.addSource({ name: 'local', url: src })
    expect(source.root).toBe(src)
    const entries = mkt.list()
    expect(entries.length).toBe(1)
    expect(entries[0].id).toBe('reviewer')
    const imported = mkt.importEntry(source.id, 'rev.md')
    expect(imported.id).toBe('reviewer')
    expect(repo.findExpert('reviewer')?.persona).toBe('人设正文')
  })

  it('拒绝越界 relPath', async () => {
    const repo = seedRepo()
    const { mkt } = market(repo)
    const src = tempDir('wsfo-src-esc-')
    writeFileSync(join(src, 'ok.md'), md('ok'))
    const source = await mkt.addSource({ name: 'esc', url: src })
    expect(() => mkt.importEntry(source.id, '../outside.md')).toThrow()
  })

  it('移除本地源不删用户目录', async () => {
    const repo = seedRepo()
    const { mkt } = market(repo)
    const src = tempDir('wsfo-src-keep-')
    writeFileSync(join(src, 'k.md'), md('k'))
    const source = await mkt.addSource({ name: 'keep', url: src })
    mkt.removeSource(source.id)
    expect(repo.findSource(source.id)).toBeUndefined()
    expect(mkt.list().length).toBe(0)
  })

  it('非法地址与重名拒绝', async () => {
    const repo = seedRepo()
    const { mkt } = market(repo)
    const src = tempDir('wsfo-src-dup-')
    await mkt.addSource({ name: 'dup', url: src })
    await expect(mkt.addSource({ name: 'dup', url: src })).rejects.toThrow()
    await expect(mkt.addSource({ name: 'bad', url: 'not a url' })).rejects.toThrow()
  })
})
