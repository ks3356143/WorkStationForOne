import { describe, expect, it } from 'vitest'
import { startLoopbackCallback } from './loopback'

describe('回环回调', () => {
  it('只接受 /oauth/callback，并返回 code 与 state', async () => {
    const server = await startLoopbackCallback([0], 2000)
    const response = await fetch(
      `${server.redirectUri}?code=code-1&state=state-1&iss=https%3A%2F%2Fa`
    )
    expect(response.status).toBe(200)
    await expect(server.wait).resolves.toEqual({
      code: 'code-1',
      state: 'state-1',
      iss: 'https://a'
    })
    server.close()
  })

  it('其它路径返回 404 且不结束等待', async () => {
    const server = await startLoopbackCallback([0], 2000)
    const base = server.redirectUri.replace('/oauth/callback', '/other')
    const response = await fetch(base)
    expect(response.status).toBe(404)
    server.close()
    await expect(server.wait).rejects.toThrow(/取消/)
  })

  it('超时会拒绝并关闭', async () => {
    const server = await startLoopbackCallback([0], 30)
    await expect(server.wait).rejects.toThrow(/超时/)
  })
})
