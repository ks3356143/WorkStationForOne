import { appendFileSync } from 'node:fs'
import { Notification } from 'electron'
import type { AgentRunEvent } from '../../shared/agent-stream'
import { IPC_CHANNELS, type AgentAttention } from '../../shared/ipc'

const MAX_TITLE = 64
const MAX_BODY = 180

function clip(value: string, max: number): string {
  const flat = value.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

export interface AttentionSession {
  id: string
  title: string
  agent: 'claude' | 'codex'
}

export interface AgentAttentionNotice {
  sessionId: string
  requestId: string
  kind: AgentAttention['kind']
  title: string
  body: string
}

type AttentionEvent = Extract<AgentRunEvent, { kind: 'permission' } | { kind: 'question' }>

function toolNotice(
  session: AttentionSession,
  requestId: string,
  tool: string,
  detail: string
): AgentAttentionNotice {
  const agent = session.agent === 'claude' ? 'Claude Code' : 'Codex'
  const name = clip(session.title || '新会话', 32)
  const suffix = detail ? `：${detail}` : ''
  return {
    sessionId: session.id,
    requestId,
    kind: 'permission',
    title: clip(`${name} · 待审批`, MAX_TITLE),
    body: clip(`${agent} 请求 ${tool}${suffix}`, MAX_BODY)
  }
}

export function buildAttentionNotice(
  session: AttentionSession,
  event: AttentionEvent
): AgentAttentionNotice {
  if (event.kind === 'question') {
    const agent = session.agent === 'claude' ? 'Claude Code' : 'Codex'
    const name = clip(session.title || '新会话', 32)
    const question = event.request.questions[0]?.question ?? 'Agent 有问题需要你回答'
    return {
      sessionId: session.id,
      requestId: event.request.requestId,
      kind: 'question',
      title: clip(`${name} · 待回答`, MAX_TITLE),
      body: clip(`${agent}：${question}`, MAX_BODY)
    }
  }
  return toolNotice(session, event.request.requestId, event.request.toolName, event.request.detail)
}

/** MCP 域写入审批也走同一张卡与同一套后台提醒。 */
export function buildMcpAttentionNotice(
  session: AttentionSession,
  request: { requestId: string; tool: string; detail: string }
): AgentAttentionNotice {
  return toolNotice(session, request.requestId, request.tool, request.detail)
}

/** 只依赖窗口的最小接口，方便单测直接构造。 */
export interface AttentionWindow {
  isDestroyed: () => boolean
  isFocused: () => boolean
  isMinimized: () => boolean
  restore: () => void
  show: () => void
  focus: () => void
  webContents: { send: (channel: string, payload: AgentAttention) => void }
}

export interface AgentNotifierOptions {
  getWindow: () => AttentionWindow | null
  /** 自动化测试缝：记录通知而不弹原生通知 */
  logFile?: string
  /** 自动化测试缝：跳过焦点判断，仍走同一通知函数 */
  force?: boolean
  deliver?: (notice: AgentAttentionNotice, onClick: () => void) => void
}

export type AgentNotifier = (notice: AgentAttentionNotice) => void

// 保留实例直到关闭 / 点击，避免对象被回收后丢失点击回调。
const liveNotifications = new Set<Notification>()

function defaultDeliver(notice: AgentAttentionNotice, onClick: () => void): void {
  if (!Notification.isSupported()) return
  const notification = new Notification({ title: notice.title, body: notice.body })
  liveNotifications.add(notification)
  const release = () => liveNotifications.delete(notification)
  notification.on('click', () => {
    release()
    onClick()
  })
  notification.on('close', release)
  notification.show()
}

/**
 * 仅当窗口不在前台时提醒。审批与追问会阻塞 Agent，后台会话尤其需要
 * 一个不打断当前工作的入口；点击通知后聚焦窗口并让渲染层切回该会话。
 */
export function createAgentNotifier(options: AgentNotifierOptions): AgentNotifier {
  const deliver = options.deliver ?? defaultDeliver
  return (notice) => {
    const win = options.getWindow()
    if (!win || win.isDestroyed()) return
    if (!options.force && win.isFocused()) return

    const focus = () => {
      if (win.isDestroyed()) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      win.webContents.send(IPC_CHANNELS.agentAttention, {
        sessionId: notice.sessionId,
        requestId: notice.requestId,
        kind: notice.kind
      })
    }

    try {
      deliver(notice, focus)
    } catch (error) {
      console.error('[agent] 通知失败', error)
    }
    if (options.logFile) {
      try {
        appendFileSync(
          options.logFile,
          `${notice.kind} ${notice.sessionId} ${notice.requestId} ${notice.body}\n`
        )
      } catch (error) {
        console.error('[agent] 写通知日志失败', error)
      }
    }
  }
}
