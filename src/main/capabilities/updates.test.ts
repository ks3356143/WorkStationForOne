import { describe, expect, it } from 'vitest'
import { collectCandidates, summarizeCandidates } from './updates'

describe('collectCandidates', () => {
  it('只保留版本更高的插件与 MCP', () => {
    const list = collectCandidates(
      [
        {
          id: 'demo@m',
          name: 'demo',
          version: '1.2.0',
          latestVersion: '1.10.0',
          agent: 'claude',
          sourceName: 'community'
        },
        {
          id: 'same@m',
          name: 'same',
          version: '2.0.0',
          latestVersion: '2.0.0',
          agent: 'claude'
        }
      ],
      [{ id: 'mcp-1', name: 'Memory', currentVersion: '1.0.0', latestVersion: '1.1.0' }]
    )

    expect(list.map((item) => item.id)).toEqual(['demo@m', 'mcp-1'])
    expect(list[0]).toMatchObject({ kind: 'plugin', current: '1.2.0', latest: '1.10.0' })
    expect(list[1]).toMatchObject({ kind: 'mcp', current: '1.0.0', latest: '1.1.0' })
  })

  it('未信任来源跳过，版本缺失跳过', () => {
    const list = collectCandidates(
      [
        {
          id: 'a@m',
          name: 'a',
          version: '1.0.0',
          latestVersion: '2.0.0',
          agent: 'codex',
          sourceTrusted: false
        },
        {
          id: 'b@m',
          name: 'b',
          version: '',
          latestVersion: '2.0.0',
          agent: 'codex'
        },
        {
          id: 'c@m',
          name: 'c',
          version: '1.0.0',
          latestVersion: '',
          agent: 'codex'
        }
      ],
      []
    )
    expect(list).toEqual([])
  })

  it('没有更新时返回空数组', () => {
    expect(
      collectCandidates(
        [
          {
            id: 'x@m',
            name: 'x',
            version: '3.0.0',
            latestVersion: '2.9.9',
            agent: 'claude'
          }
        ],
        []
      )
    ).toEqual([])
  })
})

describe('summarizeCandidates', () => {
  it('按类型汇总数量', () => {
    expect(
      summarizeCandidates([
        { kind: 'plugin', id: 'a', name: 'a', current: '1', latest: '2' },
        { kind: 'plugin', id: 'b', name: 'b', current: '1', latest: '2' },
        { kind: 'mcp', id: 'c', name: 'c', current: '1', latest: '2' }
      ])
    ).toBe('2 个插件、1 个 MCP可更新')
    expect(summarizeCandidates([])).toBe('')
  })
})
