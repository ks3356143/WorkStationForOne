import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentThreadBundle } from '../../../shared/ipc'
import { createInitialData } from '../data/mock'
import { useWorkstation } from '../store/useWorkstation'
import { hydrateAgent, type AgentHydrateDeps } from './agent-persistence'

function deps(bundle: AgentThreadBundle): AgentHydrateDeps {
  return {
    threads: vi.fn().mockResolvedValue(bundle),
    createSession: vi.fn(),
    updateSession: vi.fn().mockResolvedValue(undefined),
    saveMessage: vi.fn().mockResolvedValue(undefined)
  }
}

const bundle: AgentThreadBundle = {
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
  messages: [
    {
      id: 'u1',
      sessionId: 's-1',
      role: 'user',
      text: '定位登录 500',
      timeLabel: '14:20',
      createdAt: 1
    },
    {
      id: 'a1',
      sessionId: 's-1',
      role: 'assistant',
      text: '定位到了。',
      timeLabel: '14:21',
      createdAt: 2,
      tools: [{ name: 'Read', meta: 'auth.ts', status: '完成' }]
    }
  ]
}

beforeEach(() => {
  useWorkstation.setState(createInitialData())
})

describe('hydrateAgent', () => {
  it('用数据库会话替换演示种子，并恢复消息与 resume id', async () => {
    await hydrateAgent(deps(bundle))
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
    expect(state.threads['s-1']).toHaveLength(2)
    expect(state.threads['s-1'][1].tools?.[0]?.name).toBe('Read')
    expect(state.activeSessionId).toBe('s-1')
    expect(state.permission).toBeNull()
  })

  it('空库不写入演示会话，保持空态', async () => {
    await hydrateAgent(deps({ sessions: [], messages: [] }))
    const state = useWorkstation.getState()

    expect(state.sessions).toEqual([])
    expect(state.threads).toEqual({})
    expect(state.activeSessionId).toBe('')
    expect(state.permission).toBeNull()
  })
})
