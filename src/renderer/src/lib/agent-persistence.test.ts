import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionSummary } from '../../../shared/ipc'
import { createInitialData } from '../data/mock'
import { useWorkstation } from '../store/useWorkstation'
import { hydrateAgent, type AgentHydrateDeps } from './agent-persistence'

function deps(summary: AgentSessionSummary): AgentHydrateDeps {
  return {
    sessions: vi.fn().mockResolvedValue(summary),
    createSession: vi.fn(),
    updateSession: vi.fn().mockResolvedValue(undefined),
    saveMessage: vi.fn().mockResolvedValue(undefined)
  }
}

const summary: AgentSessionSummary = {
  sessions: [
    {
      id: 's-1',
      agent: 'claude',
      title: '重构 auth 模块',
      status: 'idle',
      resumeId: 'cli-1',
      workspace: 'C:\\work\\auth',
      createdAt: 1,
      updatedAt: Date.now()
    }
  ],
  counts: { 's-1': 2 }
}

beforeEach(() => {
  useWorkstation.setState(createInitialData())
})

describe('hydrateAgent', () => {
  it('用数据库会话替换演示种子，并只带消息数量', async () => {
    await hydrateAgent(deps(summary))
    const state = useWorkstation.getState()

    expect(state.sessions).toHaveLength(1)
    expect(state.sessions[0]).toMatchObject({
      id: 's-1',
      title: '重构 auth 模块',
      resumeId: 'cli-1',
      workspace: 'C:\\work\\auth',
      status: 'idle'
    })
    expect(state.sessions[0].meta).toContain('2 条')
    expect(state.threads).toEqual({})
    expect(state.threadsLoaded).toEqual({})
    expect(state.activeSessionId).toBe('s-1')
    expect(state.permission).toBeNull()
  })

  it('空库不写入演示会话，保持空态', async () => {
    await hydrateAgent(deps({ sessions: [], counts: {} }))
    const state = useWorkstation.getState()

    expect(state.sessions).toEqual([])
    expect(state.threads).toEqual({})
    expect(state.threadsLoaded).toEqual({})
    expect(state.activeSessionId).toBe('')
    expect(state.permission).toBeNull()
  })

  it('恢复置顶标记', async () => {
    await hydrateAgent(
      deps({
        sessions: [{ ...summary.sessions[0], pinned: true }],
        counts: {}
      })
    )
    expect(useWorkstation.getState().sessions[0]?.pinned).toBe(true)
  })

  it('恢复待真分叉标记', async () => {
    await hydrateAgent(
      deps({
        sessions: [{ ...summary.sessions[0], pendingFork: true }],
        counts: {}
      })
    )
    expect(useWorkstation.getState().sessions[0]?.pendingFork).toBe(true)
  })

  it('恢复归档标记，且不把归档会话选为当前', async () => {
    const base = summary.sessions[0]
    await hydrateAgent(
      deps({
        sessions: [
          { ...base, id: 's-archived', archived: true },
          { ...base, id: 's-live' }
        ],
        counts: {}
      })
    )
    const state = useWorkstation.getState()
    expect(state.sessions[0]?.archived).toBe(true)
    expect(state.activeSessionId).toBe('s-live')
  })
})
