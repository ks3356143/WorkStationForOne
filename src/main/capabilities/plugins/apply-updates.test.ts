import { describe, expect, it, vi } from 'vitest'
import { applyUpdates, type UpdateDeps } from './apply-updates'
import type { UpdateCandidate } from '../updates'

function deps(overrides: Partial<UpdateDeps> = {}): UpdateDeps {
  return {
    repository: {
      findPlugin: vi.fn(() => undefined),
      upsertPlugin: vi.fn()
    } as unknown as UpdateDeps['repository'],
    plugins: { update: vi.fn(async () => ({ version: '2.0.0', enabled: true })) },
    sources: {
      upgradeCodexMarketplaces: vi.fn(async () => undefined),
      reinstallCodexPlugin: vi.fn(async () => undefined)
    } as unknown as UpdateDeps['sources'],
    mcp: { applyUpdate: vi.fn(async () => ({ version: '9.9.9' })) },
    codexHome: 'C:/tmp/codex-home',
    ...overrides
  }
}

const plugin = (agent: 'claude' | 'codex'): UpdateCandidate => ({
  kind: 'plugin',
  id: `demo@market`,
  name: 'demo',
  agent,
  current: '1.0.0',
  latest: '2.0.0'
})

const mcpCandidate: UpdateCandidate = {
  kind: 'mcp',
  id: 'srv-1',
  name: 'memory',
  current: '0.1.0',
  latest: '0.2.0'
}

describe('applyUpdates', () => {
  it('Claude 插件走 plugin update', async () => {
    const d = deps()
    const outcome = await applyUpdates([plugin('claude')], d)

    expect(d.plugins.update).toHaveBeenCalledWith('demo@market')
    expect(outcome.updated).toEqual([
      { kind: 'plugin', id: 'demo@market', name: 'demo', version: '2.0.0' }
    ])
    expect(outcome.failed).toEqual([])
  })

  it('内置 MCP 走 applyUpdate', async () => {
    const d = deps()
    const outcome = await applyUpdates([mcpCandidate], d)

    expect(d.mcp.applyUpdate).toHaveBeenCalledWith('srv-1')
    expect(outcome.updated[0]).toMatchObject({ kind: 'mcp', version: '9.9.9' })
  })

  it('Codex 插件先刷新市场再重装', async () => {
    const d = deps()
    await applyUpdates([plugin('codex')], d).catch(() => undefined)

    expect(d.sources.upgradeCodexMarketplaces).toHaveBeenCalled()
    expect(d.sources.reinstallCodexPlugin).toHaveBeenCalledWith('demo', 'market')
  })

  it('只有 Codex 候选时才刷新市场快照', async () => {
    const d = deps()
    await applyUpdates([plugin('claude')], d)
    expect(d.sources.upgradeCodexMarketplaces).not.toHaveBeenCalled()
  })

  it('单条失败不阻断其它条目', async () => {
    const d = deps({
      plugins: {
        update: vi.fn(async (id: string) => {
          if (id === 'bad@market') throw new Error('插件未安装')
          return { version: '2.0.0', enabled: true }
        })
      }
    })
    const outcome = await applyUpdates(
      [
        {
          kind: 'plugin',
          id: 'bad@market',
          name: 'bad',
          agent: 'claude',
          current: '1',
          latest: '2'
        },
        plugin('claude')
      ],
      d
    )

    expect(outcome.failed).toEqual([
      { kind: 'plugin', id: 'bad@market', name: 'bad', reason: '插件未安装' }
    ])
    expect(outcome.updated).toHaveLength(1)
  })

  it('Codex 重装后磁盘上没有插件时报错', async () => {
    const d = deps()
    const outcome = await applyUpdates([plugin('codex')], d)
    // listCodexInstalled 读的是真实 codexHome（此处为空），因此这一条应失败
    expect(outcome.failed[0].reason).toContain('没有在磁盘上找到')
  })
})
