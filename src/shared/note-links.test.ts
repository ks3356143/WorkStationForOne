import { describe, expect, it } from 'vitest'
import { noteLinkName, parseNoteLinks } from './note-links'

describe('parseNoteLinks', () => {
  it('解析单个链接并给出完整标记区间', () => {
    const text = '参考 [[线代 · 特征值]] 的结论'
    const links = parseNoteLinks(text)

    expect(links).toHaveLength(1)
    expect(links[0].title).toBe('线代 · 特征值')
    expect(text.slice(links[0].start, links[0].end)).toBe('[[线代 · 特征值]]')
  })

  it('去掉标题首尾空白', () => {
    expect(parseNoteLinks('[[   标题   ]]').map((link) => link.title)).toEqual(['标题'])
  })

  it('忽略空标题与未闭合标记', () => {
    expect(parseNoteLinks('[[]]')).toEqual([])
    expect(parseNoteLinks('[[   ]]')).toEqual([])
    expect(parseNoteLinks('[[没有收尾')).toEqual([])
  })

  it('标题内不允许换行', () => {
    expect(parseNoteLinks('[[第一行\n第二行]]')).toEqual([])
  })

  it('解析多个链接且区间互不重叠', () => {
    const text = '[[A]] 与 [[B]]，还有 [[ A ]]'
    const links = parseNoteLinks(text)

    expect(links.map((link) => link.title)).toEqual(['A', 'B', 'A'])
    for (const link of links) {
      const marker = text.slice(link.start, link.end)
      expect(marker.startsWith('[[')).toBe(true)
      expect(marker.endsWith(']]')).toBe(true)
    }
    expect(links[1].start).toBeGreaterThan(links[0].end)
  })
})

describe('noteLinkName', () => {
  it('取第一个非空行并去掉首尾空白', () => {
    expect(noteLinkName('\n\n  第一行  \n第二行')).toBe('第一行')
  })

  it('长行截断到 40 个字符', () => {
    expect(noteLinkName('一'.repeat(50))).toHaveLength(40)
  })

  it('去掉会破坏链接语法的方括号', () => {
    expect(noteLinkName('标题[[坏]]')).toBe('标题坏')
  })

  it('空白笔记没有名字', () => {
    expect(noteLinkName('   \n  ')).toBe('')
  })
})
