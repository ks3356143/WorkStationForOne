import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { registerAgentHandlersIPC } = await import('./agent')

describe('智能体会话参数', () => {
  it('创建会话去掉标题首尾空白', () => {
    expect(
      registerAgentHandlersIPC.assertAgentCreateInput({
        id: 's-1',
        agent: 'claude',
        title: '  新会话  '
      })
    ).toEqual({ id: 's-1', agent: 'claude', title: '新会话' })
  })

  it('拒绝非法 agent、空标题与超长 id', () => {
    expect(() =>
      registerAgentHandlersIPC.assertAgentCreateInput({ id: 's-1', agent: 'gemini', title: 'x' })
    ).toThrow(TypeError)
    expect(() =>
      registerAgentHandlersIPC.assertAgentCreateInput({ id: 's-1', agent: 'claude', title: ' ' })
    ).toThrow(TypeError)
    expect(() =>
      registerAgentHandlersIPC.assertAgentCreateInput({
        id: 'x'.repeat(121),
        agent: 'claude',
        title: 'x'
      })
    ).toThrow(TypeError)
  })

  it('会话补丁至少含一个字段，状态只允许三档', () => {
    expect(registerAgentHandlersIPC.assertAgentSessionPatch({ status: 'idle' })).toEqual({
      status: 'idle'
    })
    expect(() => registerAgentHandlersIPC.assertAgentSessionPatch({})).toThrow(TypeError)
    expect(() => registerAgentHandlersIPC.assertAgentSessionPatch({ status: 'paused' })).toThrow(
      TypeError
    )
  })

  it('工作区必须是存在的绝对目录', () => {
    const root = mkdtempSync(join(tmpdir(), 'wsfo-agent-work-'))
    try {
      expect(registerAgentHandlersIPC.assertAgentSessionPatch({ workspace: root })).toEqual({
        workspace: root
      })
      expect(() =>
        registerAgentHandlersIPC.assertAgentSessionPatch({ workspace: 'relative/dir' })
      ).toThrow(TypeError)
      expect(() =>
        registerAgentHandlersIPC.assertAgentSessionPatch({
          workspace: join(dirname(root), 'missing-workspace')
        })
      ).toThrow(TypeError)
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    }
  })
})

describe('导入本机会话参数', () => {
  it('保留 agent / resumeId / workspace，标题为空时回退', () => {
    const root = mkdtempSync(join(tmpdir(), 'wsfo-agent-import-'))
    try {
      expect(
        registerAgentHandlersIPC.assertImportInput({
          agent: 'codex',
          resumeId: 'codex-1',
          title: '   ',
          workspace: root
        })
      ).toEqual({
        agent: 'codex',
        resumeId: 'codex-1',
        title: '导入的会话',
        workspace: root
      })
      expect(
        registerAgentHandlersIPC.assertImportInput({
          agent: 'claude',
          resumeId: 'claude-1',
          title: '  修导入  ',
          workspace: root
        }).title
      ).toBe('修导入')
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    }
  })

  it('拒绝非法 agent、空 id 与不存在的工作区', () => {
    const root = mkdtempSync(join(tmpdir(), 'wsfo-agent-import-'))
    try {
      expect(() =>
        registerAgentHandlersIPC.assertImportInput({
          agent: 'gemini',
          resumeId: 'x',
          title: 'x',
          workspace: root
        })
      ).toThrow(TypeError)
      expect(() =>
        registerAgentHandlersIPC.assertImportInput({
          agent: 'claude',
          resumeId: '',
          title: 'x',
          workspace: root
        })
      ).toThrow(TypeError)
      expect(() =>
        registerAgentHandlersIPC.assertImportInput({
          agent: 'claude',
          resumeId: 'x',
          title: 'x',
          workspace: join(dirname(root), 'missing-import-workspace')
        })
      ).toThrow(TypeError)
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    }
  })
})

describe('工具审批响应', () => {
  it('接受允许与拒绝', () => {
    expect(
      registerAgentHandlersIPC.assertPermissionResponse({ requestId: 'p1', allow: true })
    ).toEqual({
      requestId: 'p1',
      allow: true
    })
    expect(
      registerAgentHandlersIPC.assertPermissionResponse({
        requestId: 'p1',
        allow: false,
        message: '  用户拒绝  '
      })
    ).toEqual({ requestId: 'p1', allow: false, message: '用户拒绝' })
  })

  it('拒绝非法 requestId、allow 与超长原因', () => {
    expect(() =>
      registerAgentHandlersIPC.assertPermissionResponse({ requestId: '', allow: true })
    ).toThrow(TypeError)
    expect(() =>
      registerAgentHandlersIPC.assertPermissionResponse({ requestId: 'p1', allow: 'yes' })
    ).toThrow(TypeError)
    expect(() =>
      registerAgentHandlersIPC.assertPermissionResponse({
        requestId: 'p1',
        allow: false,
        message: 'x'.repeat(501)
      })
    ).toThrow(TypeError)
  })
})

describe('发送请求', () => {
  it('保留 agent 类型并校验提示词', () => {
    expect(
      registerAgentHandlersIPC.assertAgentSendInput({
        sessionId: 's-1',
        agent: 'codex',
        prompt: '  读一下入口  '
      })
    ).toEqual({ sessionId: 's-1', agent: 'codex', prompt: '读一下入口' })
    expect(() =>
      registerAgentHandlersIPC.assertAgentSendInput({ sessionId: 's-1', prompt: 'x' })
    ).toThrow(TypeError)
    expect(() =>
      registerAgentHandlersIPC.assertAgentSendInput({
        sessionId: 's-1',
        agent: 'gemini',
        prompt: 'x'
      })
    ).toThrow(TypeError)
    expect(() =>
      registerAgentHandlersIPC.assertAgentSendInput({
        sessionId: 's-1',
        agent: 'claude',
        prompt: '   '
      })
    ).toThrow(TypeError)
  })
})

describe('智能体消息参数', () => {
  const message = {
    id: 'm-1',
    sessionId: 's-1',
    role: 'assistant',
    text: '回复',
    timeLabel: '刚刚',
    tools: [{ id: 't-1', name: 'Read', meta: '1 个文件', status: '完成' }],
    createdAt: 1
  }

  it('接受带工具卡的助手消息', () => {
    expect(registerAgentHandlersIPC.assertAgentMessage(message)).toEqual(message)
  })

  it('拒绝非法角色、工具结构与超长文本', () => {
    expect(() =>
      registerAgentHandlersIPC.assertAgentMessage({ ...message, role: 'system' })
    ).toThrow(TypeError)
    expect(() =>
      registerAgentHandlersIPC.assertAgentMessage({
        ...message,
        tools: [{ name: 'Read' }]
      })
    ).toThrow(TypeError)
    expect(() =>
      registerAgentHandlersIPC.assertAgentMessage({ ...message, text: 'x'.repeat(20_001) })
    ).toThrow(TypeError)
  })
})
