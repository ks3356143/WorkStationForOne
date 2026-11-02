import { describe, expect, it } from 'vitest'
import { friendlyError, friendlyMessage } from './errors'

describe('friendlyError', () => {
  it('把未登录归到 auth 并给出登录建议', () => {
    const e = friendlyError(new Error('Not logged in · Please run /login'))
    expect(e.kind).toBe('auth')
    expect(e.hint).toContain('claude login')
    expect(e.detail).toContain('Not logged in')
  })

  it('识别 CLI 缺失', () => {
    expect(friendlyError(new Error('未找到 Claude CLI，请先安装并登录 claude')).kind).toBe(
      'cli-missing'
    )
    expect(friendlyError(new Error('spawn claude ENOENT')).kind).toBe('cli-missing')
  })

  it('识别权限、磁盘、超时、限流、网络', () => {
    expect(friendlyError(new Error('EPERM: operation not permitted')).kind).toBe('permission')
    expect(friendlyError(new Error('ENOSPC: no space left')).kind).toBe('disk')
    expect(friendlyError('MCP 连接超时')).toMatchObject({ kind: 'timeout' })
    expect(friendlyError(new Error('HTTP 429 请求受限')).kind).toBe('rate-limit')
    expect(friendlyError(new Error('fetch failed')).kind).toBe('network')
  })

  it('剥掉层层包装前缀，不重复「无法加载」', () => {
    const e = friendlyError(
      new Error('无法加载应用私有技能 / MCP：无法加载 Codex 外部 MCP：ECONNRESET')
    )
    expect(e.kind).toBe('network')
    expect(e.title).toBe('连不上服务')
  })

  it('未知错误保留原文，但给出排查建议', () => {
    const e = friendlyError(new Error('插件清单格式不对'))
    expect(e.kind).toBe('unknown')
    expect(e.title).toBe('插件清单格式不对')
    expect(e.hint).toContain('详情')
  })

  it('非 Error 输入用兜底文案', () => {
    const e = friendlyError(null, '读取失败')
    expect(e.kind).toBe('unknown')
    expect(e.title).toBe('读取失败')
    expect(e.detail).toBe('')
  })

  it('详情截断，避免超长堆栈撑破卡片', () => {
    const e = friendlyError(new Error('x'.repeat(2000)))
    expect(e.detail.length).toBeLessThanOrEqual(600)
  })
})

describe('friendlyMessage', () => {
  it('标题与建议合成一行', () => {
    expect(friendlyMessage(new Error('429 rate limit'))).toContain('等一两分钟')
  })
})
