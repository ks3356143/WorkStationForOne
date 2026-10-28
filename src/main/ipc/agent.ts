import { ipcMain, type BrowserWindow } from 'electron'
import type { AgentCli } from '../agent/claude'
import { startClaudeRun } from '../agent/claude'
import { IPC_CHANNELS, type AgentSendInput } from '../../shared/ipc'
import type { AgentRunEvent } from '../../shared/agent-stream'

const IPC = IPC_CHANNELS
const MAX_PROMPT = 20_000
const MAX_ID = 120

function assertId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID) {
    throw new TypeError(`${label}无效`)
  }
  return value
}

export function assertAgentSendInput(value: unknown): AgentSendInput {
  if (typeof value !== 'object' || value === null) throw new TypeError('Agent 请求必须是对象')
  const input = value as Record<string, unknown>
  const prompt = input.prompt
  if (typeof prompt !== 'string') throw new TypeError('提示词无效')
  const trimmed = prompt.trim()
  if (!trimmed) throw new TypeError('提示词不能为空')
  if (trimmed.length > MAX_PROMPT) throw new TypeError('提示词过长')
  const result: AgentSendInput = {
    sessionId: assertId(input.sessionId, '会话 id'),
    prompt: trimmed
  }
  if (input.resumeId !== undefined) result.resumeId = assertId(input.resumeId, '续接会话 id')
  return result
}

interface ActiveRun {
  sessionId: string
  cancel: () => void
}

/**
 * 当前只支持一个并发回合：Agent 视图一次只跟一个会话说话，
 * 多开会话的排队与并发留给后续版本，避免 v1 出现交叉写入。
 */
export function registerAgentHandlers(
  getWindow: () => BrowserWindow | null,
  cli?: AgentCli | null
): void {
  const runs = new Map<string, ActiveRun>()
  let seq = 0

  ipcMain.handle(IPC.agentSend, (_event, value: unknown) => {
    const input = assertAgentSendInput(value)
    if (runs.size > 0) throw new Error('上一轮还在进行中，先取消或等待完成')
    seq += 1
    const runId = `run-${seq}`

    const emit = (runEvent: AgentRunEvent) => {
      const win = getWindow()
      if (!win || win.isDestroyed()) return
      win.webContents.send(IPC.agentEvent, { runId, event: runEvent })
    }

    const handle = startClaudeRun({
      prompt: input.prompt,
      resumeId: input.resumeId,
      cwd: process.cwd(),
      ...(cli === undefined ? {} : { cli }),
      onEvent: emit,
      onExit: ({ code, stderr, cancelled }) => {
        runs.delete(runId)
        if (cancelled) {
          emit({ kind: 'error', message: '已取消' })
          return
        }
        if (code !== 0) {
          const detail = stderr.trim().split(/\r?\n/).at(-1) ?? ''
          emit({ kind: 'error', message: detail || `CLI 退出码 ${code}` })
        }
      }
    })

    runs.set(runId, { sessionId: input.sessionId, cancel: handle.cancel })
    return { runId }
  })

  ipcMain.handle(IPC.agentCancel, (_event, runId: unknown) => {
    const id = assertId(runId, '运行 id')
    runs.get(id)?.cancel()
    runs.delete(id)
  })
}
