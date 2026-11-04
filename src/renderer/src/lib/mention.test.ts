import { describe, expect, it } from 'vitest'
import type { WorkspaceEntry } from '../../../shared/ipc'
import { filterWorkspaceFiles, matchMention, removeMention } from './mention'

const entries: WorkspaceEntry[] = [
  { path: 'src', type: 'dir', size: 0 },
  { path: 'src/main.ts', type: 'file', size: 120 },
  { path: 'src/renderer/App.tsx', type: 'file', size: 400 },
  { path: 'docs/readme.md', type: 'file', size: 60 }
]

describe('@ 文件提及', () => {
  it('识别光标前的 @ 查询', () => {
    expect(matchMention('看看 @src/ma', 10)).toEqual({ start: 3, query: 'src/ma' })
    expect(matchMention('@', 1)).toEqual({ start: 0, query: '' })
  })

  it('邮件地址、空白后与光标之后的 @ 不触发', () => {
    expect(matchMention('a@b.com', 7)).toBeNull()
    expect(matchMention('看看 @ ', 5)).toBeNull()
    expect(matchMention('看看 @src', 2)).toBeNull()
  })

  it('过滤只保留文件并忽略大小写', () => {
    expect(filterWorkspaceFiles(entries, 'SRC').map((entry) => entry.path)).toEqual([
      'src/main.ts',
      'src/renderer/App.tsx'
    ])
    expect(filterWorkspaceFiles(entries, 'readme.md').map((entry) => entry.path)).toEqual([
      'docs/readme.md'
    ])
    expect(filterWorkspaceFiles(entries, 'zzz')).toEqual([])
  })

  it('附加后从草稿里移除 @ 片段', () => {
    expect(removeMention('看看 @src/ma 这个', 3, 'src/ma')).toBe('看看  这个')
    expect(removeMention('@a', 0, 'a')).toBe('')
  })
})
