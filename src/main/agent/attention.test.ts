import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentRunEvent } from '../../shared/agent-stream'
import { IPC_CHANNELS } from '../../shared/ipc'
import {
  buildAttentionNotice,
  buildMcpAttentionNotice,
  createAgentNotifier,
  type AttentionSession,
  type AttentionWindow
} from './attention'

vi.mock('electron', () => ({
  Notification: { isSupported: () => false }
}))

const session: AttentionSession = { id: 's-1', title: '重构 auth', agent: 'claude' }
const permission: AgentRunEvent = {
  kind: 'permission',
  request: {
    requestId: 'run-1:req-1',
    toolName: 'Write',
    toolUseId: 'tool-1',
    detail: 'src/a.ts',
    inputPreview: '{}'
  }
}
const question: AgentRunEvent = {
  kind: 'question',
  request: {
    requestId: 'run-1:q-1',
    toolUseId: 'tool-2',
    questions: [
      {
        header: '覆盖',
        question: '要覆盖现有文件吗？',
        options: [{ label: '覆盖' }, { label: '保留' }]
      }
    ]
  }
}

function fakeWindow(focused = false, minimized = false) {
  const sent: { channel: string; payload: unknown }[] = []
  const win: AttentionWindow = {
    isDestroyed: () => false,
    isFocused: () => focused,
    isMinimized: () => minimized,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: {
      send: (channel, payload) => {
        sent.push({ channel, payload })
      }
    }
  }
  return { win, sent }
}

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('buildAttentionNotice', () => {
  it('审批显示会话、Agent、工具与目标', () => {
    expect(buildAttentionNotice(session, permission)).toMatchObject({
      sessionId: 's-1',
      requestId: 'run-1:req-1',
      kind: 'permission',
      title: '重构 auth · 待审批',
      body: 'Claude Code 请求 Write：src/a.ts'
    })
  })

  it('MCP 写入审批复用同一套审批通知', () => {
    expect(
      buildMcpAttentionNotice(session, {
        requestId: 'm-1',
        tool: 'tasks_create',
        detail: '创建任务'
      })
    ).toMatchObject({
      kind: 'permission',
      title: '重构 auth · 待审批',
      body: 'Claude Code 请求 tasks_create：创建任务'
    })
  })

  it('问答显示第一个问题', () => {
    expect(buildAttentionNotice({ ...session, agent: 'codex' }, question)).toMatchObject({
      kind: 'question',
      title: '重构 auth · 待回答',
      body: 'Codex：要覆盖现有文件吗？'
    })
  })

  it('过长标题与正文按上限截断', () => {
    const notice = buildAttentionNotice(
      { ...session, title: '长'.repeat(100) },
      {
        kind: 'permission',
        request: {
          ...permission.request,
          detail: 'x'.repeat(300)
        }
      }
    )
    expect(notice.title.length).toBeLessThanOrEqual(64)
    expect(notice.body.length).toBeLessThanOrEqual(180)
    expect(notice.title.includes('…')).toBe(true)
    expect(notice.body.endsWith('…')).toBe(true)
  })
})

describe('createAgentNotifier', () => {
  it('窗口在前台时不发通知', () => {
    const { win } = fakeWindow(true)
    const deliver = vi.fn()
    const notify = createAgentNotifier({ getWindow: () => win, deliver })

    notify(buildAttentionNotice(session, permission))

    expect(deliver).not.toHaveBeenCalled()
  })

  it('窗口失焦时通知，点击后恢复焦点并路由回会话', () => {
    const { win, sent } = fakeWindow(false, true)
    let click: (() => void) | undefined
    const deliver = vi.fn((_notice, onClick: () => void) => {
      click = onClick
    })
    const notify = createAgentNotifier({ getWindow: () => win, deliver })

    notify(buildAttentionNotice(session, permission))
    expect(deliver).toHaveBeenCalledTimes(1)

    click?.()
    expect(win.restore).toHaveBeenCalled()
    expect(win.show).toHaveBeenCalled()
    expect(win.focus).toHaveBeenCalled()
    expect(sent).toEqual([
      {
        channel: IPC_CHANNELS.agentAttention,
        payload: { sessionId: 's-1', requestId: 'run-1:req-1', kind: 'permission' }
      }
    ])
  })

  it('测试缝可强制通知并写入日志', () => {
    const root = mkdtempSync(join(tmpdir(), 'wsfo-attention-'))
    roots.push(root)
    const logFile = join(root, 'attention.log')
    const { win } = fakeWindow(true)
    const notify = createAgentNotifier({
      getWindow: () => win,
      logFile,
      force: true,
      deliver: () => {}
    })

    notify(buildAttentionNotice({ ...session, agent: 'codex' }, question))

    expect(readFileSync(logFile, 'utf8')).toContain(
      'question s-1 run-1:q-1 Codex：要覆盖现有文件吗？'
    )
  })

  it('没有窗口时安静跳过', () => {
    const deliver = vi.fn()
    const notify = createAgentNotifier({ getWindow: () => null, deliver })

    expect(() => notify(buildAttentionNotice(session, permission))).not.toThrow()
    expect(deliver).not.toHaveBeenCalled()
  })
})
