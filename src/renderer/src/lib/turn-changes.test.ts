import { describe, expect, it } from 'vitest'
import type { AgentFileDiff } from '../../../shared/agent-stream'
import { summarizeTurnChanges } from './turn-changes'

function diff(overrides: Partial<AgentFileDiff> = {}): AgentFileDiff {
  return { path: 'a.ts', oldText: '', newText: '', ...overrides }
}

function tool(...diffs: AgentFileDiff[]) {
  return { diffs }
}

describe('summarizeTurnChanges', () => {
  it('没有文件改动时返回 null', () => {
    expect(summarizeTurnChanges(undefined)).toBeNull()
    expect(summarizeTurnChanges([])).toBeNull()
    expect(summarizeTurnChanges([{}, { diffs: [] }])).toBeNull()
  })

  it('按文件汇总新增、删除与改动类型', () => {
    const summary = summarizeTurnChanges([
      tool(
        diff({ path: 'src/a.ts', oldText: 'one\ntwo\n', newText: 'one\nTWO\nthree\n' }),
        diff({ path: 'notes/b.md', oldText: '', newText: '# B\n' }),
        diff({ path: 'tmp/c.txt', oldText: 'old\n', newText: '' })
      )
    ])

    expect(summary?.files).toEqual([
      {
        path: 'src/a.ts',
        kind: 'update',
        additions: 2,
        deletions: 1,
        edits: 1,
        truncated: false,
        partial: false
      },
      {
        path: 'notes/b.md',
        kind: 'add',
        additions: 1,
        deletions: 0,
        edits: 1,
        truncated: false,
        partial: false
      },
      {
        path: 'tmp/c.txt',
        kind: 'delete',
        additions: 0,
        deletions: 1,
        edits: 1,
        truncated: false,
        partial: false
      }
    ])
    expect(summary?.additions).toBe(3)
    expect(summary?.deletions).toBe(2)
  })

  it('同一文件多次编辑按首份旧内容与末份新内容计算净变化', () => {
    const summary = summarizeTurnChanges([
      tool(diff({ path: 'src/a.ts', oldText: 'A\n', newText: 'B\n' })),
      tool(diff({ path: 'src/a.ts', oldText: 'B\n', newText: 'C\n' }))
    ])

    expect(summary?.files).toHaveLength(1)
    expect(summary?.files[0]).toMatchObject({
      path: 'src/a.ts',
      additions: 1,
      deletions: 1,
      edits: 2
    })
  })

  it('截断与部分片段标记会带到文件与总计', () => {
    const summary = summarizeTurnChanges([
      tool(
        diff({ path: 'src/a.ts', oldText: 'A\n', newText: 'B\n', truncated: true, partial: true })
      )
    ])

    expect(summary?.files[0]).toMatchObject({ truncated: true, partial: true })
    expect(summary?.truncated).toBe(true)
    expect(summary?.partial).toBe(true)
  })

  it('忽略没有路径或没有差异内容的条目', () => {
    const summary = summarizeTurnChanges([
      tool(diff({ path: '', oldText: 'A\n', newText: 'B\n' })),
      tool(diff({ path: 'src/empty.ts', oldText: '', newText: '' }))
    ])

    expect(summary?.files.map((file) => file.path)).toEqual(['src/empty.ts'])
  })

  it('多个文件保持首次出现的顺序', () => {
    const summary = summarizeTurnChanges([
      tool(diff({ path: 'b.ts', oldText: 'B\n', newText: 'B2\n' })),
      tool(diff({ path: 'a.ts', oldText: 'A\n', newText: 'A2\n' })),
      tool(diff({ path: 'b.ts', oldText: 'B2\n', newText: 'B3\n' }))
    ])

    expect(summary?.files.map((file) => file.path)).toEqual(['b.ts', 'a.ts'])
  })
})
