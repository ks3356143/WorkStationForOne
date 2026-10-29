import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MIGRATIONS, migrate, openDatabase, userVersion } from './database'
import { NoteRepository, planSearch } from './notes'
import type { NoteRecord } from '../../shared/ipc'

const dirs: string[] = []

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'wsfo-notes-'))
  dirs.push(dir)
  return openDatabase(join(dir, 'workstation.db'))
}

function seedDb() {
  const db = tempDb()
  migrate(db)
  return { db, repo: new NoteRepository(db) }
}

afterEach(() => {
  while (dirs.length) {
    rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

const notes: NoteRecord[] = [
  {
    id: 'n1',
    text: '工作台不是聊天窗口，是把 agent 的产出沉淀成可检索的记忆。',
    time: '今天 13:58',
    tag: '产品思考',
    pinned: true
  },
  { id: 'n2', text: '线代 · 特征值三条性质', time: '12:20' },
  { id: 'n3', text: 'Codex 周报提示词 v2', time: '昨天' },
  { id: 'n4', text: '登录 500 的修复思路：session 过期分支未捕获异常', time: '周二' }
]

describe('迁移', () => {
  it('笔记迁移建立 FTS 表并推进到最新版本', () => {
    const { db } = seedDb()
    expect(userVersion(db)).toBe(MIGRATIONS.at(-1)!.version)
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type IN ('table','trigger') AND name LIKE 'notes%'"
      )
      .all()
      .map((row) => (row as { name: string }).name)
    expect(tables).toEqual(
      expect.arrayContaining(['notes', 'notes_fts', 'notes_fts_insert', 'notes_fts_update'])
    )
    db.close()
  })
})

describe('NoteRepository 列表', () => {
  it('首次启动写入种子，置顶优先', () => {
    const { db, repo } = seedDb()
    repo.bootstrap(notes)

    const page = repo.page(0, 10)
    expect(page.total).toBe(4)
    expect(page.items[0].id).toBe('n1')
    expect(page.items[0].pinned).toBe(true)
    db.close()
  })

  it('已有数据时不再写入种子', () => {
    const { db, repo } = seedDb()
    repo.bootstrap(notes)
    repo.bootstrap([{ id: 'x', text: '不应写入', time: '—' }])
    expect(repo.count()).toBe(4)
    db.close()
  })

  it('分页只返回请求的条数', () => {
    const { db, repo } = seedDb()
    repo.bootstrap(notes)

    const first = repo.page(0, 2)
    const second = repo.page(2, 2)
    expect(first.items).toHaveLength(2)
    expect(second.items).toHaveLength(2)
    expect(first.total).toBe(4)
    expect(new Set([...first.items, ...second.items].map((note) => note.id)).size).toBe(4)
    db.close()
  })

  it('限制单页上限并修正负数偏移', () => {
    const { db, repo } = seedDb()
    repo.bootstrap(notes)
    expect(repo.page(-5, 1000).items.length).toBeLessThanOrEqual(200)
    db.close()
  })
})

describe('NoteRepository 搜索', () => {
  it('三字及以上中文走 FTS 并能命中', () => {
    const { db, repo } = seedDb()
    repo.bootstrap(notes)

    const hits = repo.search('特征值', 10)
    expect(hits.map((hit) => hit.id)).toEqual(['n2'])
    expect(hits[0].snippet).toContain('[特征值]')
    db.close()
  })

  it('两字中文回退 LIKE 仍能命中', () => {
    const { db, repo } = seedDb()
    repo.bootstrap(notes)

    const hits = repo.search('登录', 10)
    expect(hits.map((hit) => hit.id)).toContain('n4')
    expect(hits[0].snippet).toContain('[登录]')
    db.close()
  })

  it('英文关键词可命中', () => {
    const { db, repo } = seedDb()
    repo.bootstrap(notes)

    expect(repo.search('agent', 10).map((hit) => hit.id)).toEqual(['n1'])
    db.close()
  })

  it('普通关键词不会被当成 FTS 语法', () => {
    const { db, repo } = seedDb()
    repo.bootstrap(notes)

    expect(() => repo.search('"(', 10)).not.toThrow()
    expect(() => repo.search('NOT AND OR', 10)).not.toThrow()
    expect(() => repo.search('*', 10)).not.toThrow()
    db.close()
  })

  it('LIKE 回退转义 % 与 _', () => {
    const { db, repo } = seedDb()
    repo.bootstrap([{ id: 'p1', text: '进度 100% 完成', time: '—' }])

    expect(repo.search('100%', 10)).toHaveLength(1)
    expect(repo.search('%', 10)).toHaveLength(1)
    db.close()
  })

  it('短词多关键词必须同时命中', () => {
    const { db, repo } = seedDb()
    repo.bootstrap([
      { id: 'm1', text: '登录 修复 思路', time: '—' },
      { id: 'm2', text: '登录失败', time: '—' }
    ])

    expect(repo.search('登录 修复', 10).map((hit) => hit.id)).toEqual(['m1'])
    db.close()
  })

  it('长词搜索也能命中标签，与短词回退结果一致', () => {
    const { db, repo } = seedDb()
    repo.bootstrap(notes)

    expect(repo.search('产品思考', 10).map((hit) => hit.id)).toEqual(['n1'])
    db.close()
  })

  it('空查询返回空数组', () => {
    const { db, repo } = seedDb()
    repo.bootstrap(notes)
    expect(repo.search('   ', 10)).toEqual([])
    db.close()
  })
})

describe('NoteRepository 写入', () => {
  it('新建笔记后排在非置顶项之前并同步进 FTS 索引', () => {
    const { db, repo } = seedDb()
    repo.bootstrap(notes)

    const created = repo.create('新的检索测试笔记', '想法')
    expect(created.text).toBe('新的检索测试笔记')

    const page = repo.page(0, 10)
    expect(page.items[0].id).toBe('n1')
    expect(page.items[1].id).toBe(created.id)
    expect(repo.search('检索测试', 10).map((hit) => hit.id)).toContain(created.id)
    db.close()
  })

  it('切换置顶状态影响排序', () => {
    const { db, repo } = seedDb()
    repo.bootstrap(notes)

    repo.togglePin('n2')
    expect(repo.page(0, 1).items[0].id).toBe('n2')

    repo.togglePin('n2')
    expect(repo.page(0, 1).items[0].id).toBe('n1')
    db.close()
  })

  it('关闭后重开数据仍在', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsfo-notes-'))
    dirs.push(dir)
    const file = join(dir, 'workstation.db')

    const first = openDatabase(file)
    migrate(first)
    new NoteRepository(first).bootstrap(notes)
    first.close()

    const second = openDatabase(file)
    migrate(second)
    expect(new NoteRepository(second).count()).toBe(4)
    second.close()
  })
})

describe('planSearch', () => {
  it('三字以上使用 FTS 短语', () => {
    expect(planSearch('特征值')).toMatchObject({ mode: 'fts', value: '"特征值"' })
  })

  it('少于三字回退 LIKE', () => {
    expect(planSearch('登录')?.mode).toBe('like')
  })

  it('转义引号避免语法错误', () => {
    expect(planSearch('abc"def')).toMatchObject({ mode: 'fts', value: '"abc""def"' })
  })

  it('空白输入返回 null', () => {
    expect(planSearch('  ')).toBeNull()
  })
})

describe('NoteRepository 链接', () => {
  it('保存正文时建立出链与反向链接', () => {
    const { db, repo } = seedDb()
    const target = repo.create('线代 · 特征值\n三条性质')
    const source = repo.create('复习计划\n先看 [[线代 · 特征值]]')

    const links = repo.links(source.id)
    expect(links.outgoing).toHaveLength(1)
    expect(links.outgoing[0]).toMatchObject({
      title: '线代 · 特征值',
      status: 'ok',
      targetId: target.id
    })
    expect(repo.links(target.id).backlinks.map((note) => note.id)).toEqual([source.id])
    db.close()
  })

  it('更新正文会重写链接', () => {
    const { db, repo } = seedDb()
    const target = repo.create('目标笔记')
    const source = repo.create('来源\n[[目标笔记]]')

    repo.update(source.id, { text: '来源\n不再引用' })
    expect(repo.links(source.id).outgoing).toEqual([])
    expect(repo.links(target.id).backlinks).toEqual([])

    repo.update(source.id, { text: '来源\n重新引用 [[目标笔记]]' })
    expect(repo.links(target.id).backlinks.map((note) => note.id)).toEqual([source.id])
    db.close()
  })

  it('重名标题不建立链接并标记歧义', () => {
    const { db, repo } = seedDb()
    repo.create('重名\n第一篇')
    repo.create('重名\n第二篇')
    const source = repo.create('来源\n[[重名]]')

    expect(repo.links(source.id).outgoing[0]).toMatchObject({ status: 'ambiguous' })
    expect(repo.links(source.id).outgoing[0].targetId).toBeUndefined()
    db.close()
  })

  it('不存在的标题标记为缺失', () => {
    const { db, repo } = seedDb()
    const source = repo.create('来源\n[[不存在的笔记]]')
    expect(repo.links(source.id).outgoing[0]).toMatchObject({
      title: '不存在的笔记',
      status: 'missing'
    })
    db.close()
  })

  it('目标笔记改名后旧链接仍指向它', () => {
    const { db, repo } = seedDb()
    const target = repo.create('旧名字\n正文')
    const source = repo.create('来源\n[[旧名字]]')

    repo.update(target.id, { text: '新名字\n正文' })
    const link = repo.links(source.id).outgoing[0]
    expect(link).toMatchObject({ title: '旧名字', status: 'ok', targetId: target.id })
    expect(link.target?.text).toBe('新名字\n正文')
    expect(repo.links(target.id).backlinks.map((note) => note.id)).toEqual([source.id])
    db.close()
  })

  it('删除目标笔记后级联清掉链接', () => {
    const { db, repo } = seedDb()
    const target = repo.create('目标笔记')
    const source = repo.create('来源\n[[目标笔记]]')

    repo.remove(target.id)
    expect(repo.links(source.id).outgoing[0]).toMatchObject({ status: 'missing' })
    expect((db.prepare('SELECT COUNT(*) AS n FROM note_links').get() as { n: number }).n).toBe(0)
    db.close()
  })

  it('补全只返回唯一的笔记名并排除自己', () => {
    const { db, repo } = seedDb()
    const a = repo.create('项目计划\nA')
    repo.create('项目计划\nB')
    const c = repo.create('项目复盘\nC')

    expect(repo.titles('项目', 10, c.id)).toEqual([])
    expect(repo.titles('项目复盘', 10, a.id)).toEqual(['项目复盘'])
    expect(repo.titles('项目计划', 10, a.id)).toEqual([])
    db.close()
  })

  it('重开后链接仍在', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsfo-notes-'))
    dirs.push(dir)
    const file = join(dir, 'workstation.db')

    const first = openDatabase(file)
    migrate(first)
    const repo = new NoteRepository(first)
    const target = repo.create('持久化目标')
    const source = repo.create('持久化来源\n[[持久化目标]]')
    first.close()

    const second = openDatabase(file)
    migrate(second)
    const reopened = new NoteRepository(second)
    expect(reopened.links(source.id).outgoing[0]).toMatchObject({
      status: 'ok',
      targetId: target.id
    })
    expect(reopened.links(target.id).backlinks.map((note) => note.id)).toEqual([source.id])
    second.close()
  })
})

describe('NoteRepository 编辑与删除', () => {
  it('更新正文后列表与全文索引都跟着变', () => {
    const { db, repo } = seedDb()
    repo.bootstrap(notes)
    repo.update('n2', { text: '线代 · 特征向量的几何意义' })
    expect(repo.page(0, 10).items.find((note) => note.id === 'n2')?.text).toBe(
      '线代 · 特征向量的几何意义'
    )
    // FTS 由触发器同步：旧词查不到、新词查得到
    expect(repo.search('特征值', 10).some((hit) => hit.id === 'n2')).toBe(false)
    expect(repo.search('特征向量', 10).map((hit) => hit.id)).toContain('n2')
    db.close()
  })

  it('更新标签与置顶状态', () => {
    const { db, repo } = seedDb()
    repo.bootstrap(notes)
    repo.update('n3', { tag: '提示词', pinned: true })
    const row = repo.page(0, 10).items.find((note) => note.id === 'n3')
    expect(row).toMatchObject({ tag: '提示词', pinned: true })
    db.close()
  })

  it('标签传空字符串表示清除', () => {
    const { db, repo } = seedDb()
    repo.bootstrap(notes)
    repo.update('n1', { tag: '' })
    expect(repo.page(0, 10).items.find((note) => note.id === 'n1')?.tag).toBeUndefined()
    db.close()
  })

  it('删除后总数与搜索都不再返回它', () => {
    const { db, repo } = seedDb()
    repo.bootstrap(notes)
    repo.remove('n4')
    expect(repo.count()).toBe(3)
    expect(repo.search('session', 10)).toEqual([])
    expect(repo.page(0, 10).items.some((note) => note.id === 'n4')).toBe(false)
    db.close()
  })

  it('删除不存在的 id 不抛错', () => {
    const { db, repo } = seedDb()
    repo.bootstrap(notes)
    expect(() => repo.remove('missing')).not.toThrow()
    expect(repo.count()).toBe(4)
    db.close()
  })

  it('更新不存在的 id 返回 undefined 而不是写脏数据', () => {
    const { db, repo } = seedDb()
    repo.bootstrap(notes)
    expect(repo.update('missing', { text: '不存在' })).toBeUndefined()
    expect(repo.count()).toBe(4)
    db.close()
  })

  it('编辑后重新打开仍然保留修改', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsfo-notes-'))
    dirs.push(dir)
    const file = join(dir, 'workstation.db')

    const first = openDatabase(file)
    migrate(first)
    const repo = new NoteRepository(first)
    repo.bootstrap(notes)
    repo.update('n2', { text: '改写后的正文' })
    repo.remove('n3')
    first.close()

    const second = openDatabase(file)
    migrate(second)
    const reopened = new NoteRepository(second)
    expect(reopened.page(0, 10).items.find((note) => note.id === 'n2')?.text).toBe('改写后的正文')
    expect(reopened.page(0, 10).items.some((note) => note.id === 'n3')).toBe(false)
    second.close()
  })
})
