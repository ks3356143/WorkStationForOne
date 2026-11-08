import { beforeEach, describe, expect, it } from 'vitest'
import { useWorkstation } from './useWorkstation'

const req = (requestId: string) =>
  ({ requestId, sessionId: 's1', toolName: 'Write', detail: '', inputPreview: '' }) as never

beforeEach(() => {
  useWorkstation.setState({ toolPermissions: {}, toolPermissionQueues: {} } as never)
})

describe('同会话审批排队', () => {
  it('第二张卡进入队列而不覆盖第一张', () => {
    useWorkstation.getState().setToolPermission('s1', req('a'))
    useWorkstation.getState().setToolPermission('s1', req('b'))
    const state = useWorkstation.getState()
    expect(state.toolPermissions.s1.requestId).toBe('a')
    expect(state.toolPermissionQueues.s1.map((item) => item.requestId)).toEqual(['b'])
  })

  it('应答当前卡后提升队首', () => {
    useWorkstation.getState().setToolPermission('s1', req('a'))
    useWorkstation.getState().setToolPermission('s1', req('b'))
    useWorkstation.getState().clearToolPermission('s1')
    const state = useWorkstation.getState()
    expect(state.toolPermissions.s1.requestId).toBe('b')
    expect(state.toolPermissionQueues.s1 ?? []).toEqual([])
  })

  it('无队列时清空当前卡', () => {
    useWorkstation.getState().setToolPermission('s1', req('a'))
    useWorkstation.getState().clearToolPermission('s1')
    expect(useWorkstation.getState().toolPermissions.s1).toBeUndefined()
  })
})
