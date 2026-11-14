import { describe, expect, it } from 'vitest'
import { buildLocalSummaryPrompt, isLocalEndpoint, summarizeTurnsWithLocal } from './local-model'

const turns = [
  { role: 'user' as const, text: '帮我看看构建' },
  { role: 'assistant' as const, text: '已经通过' }
]
const okFetch = (content: unknown) =>
  (async () =>
    ({
      ok: true,
      json: async () => ({ choices: [{ message: { content } }] })
    }) as unknown as Response) as unknown as typeof fetch

describe('isLocalEndpoint', () => {
  it('只接受回环地址', () => {
    expect(isLocalEndpoint('http://127.0.0.1:11434/v1')).toBe(true)
    expect(isLocalEndpoint('http://localhost:8080')).toBe(true)
    expect(isLocalEndpoint('http://[::1]:8080')).toBe(true)
    expect(isLocalEndpoint('https://api.openai.com/v1')).toBe(false)
    expect(isLocalEndpoint('file:///tmp/x')).toBe(false)
    expect(isLocalEndpoint('not a url')).toBe(false)
  })
})

describe('buildLocalSummaryPrompt', () => {
  it('拼角色并截断', () => {
    expect(buildLocalSummaryPrompt(turns)).toContain('用户：帮我看看构建')
    expect(buildLocalSummaryPrompt([{ role: 'user', text: 'x'.repeat(100) }], 10).length).toBe(10)
  })
})

describe('summarizeTurnsWithLocal', () => {
  it('成功返回摘要', async () => {
    const summary = await summarizeTurnsWithLocal({
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen2.5:7b',
      turns,
      fetchImpl: okFetch('  要点一\n要点二  ')
    })
    expect(summary).toBe('要点一\n要点二')
  })

  it('非本机地址不发请求', async () => {
    let called = false
    const summary = await summarizeTurnsWithLocal({
      baseUrl: 'https://api.example.com',
      model: 'x',
      turns,
      fetchImpl: (async () => {
        called = true
        return { ok: true, json: async () => ({}) } as unknown as Response
      }) as unknown as typeof fetch
    })
    expect(summary).toBeNull()
    expect(called).toBe(false)
  })

  it('请求失败 / 空结果返回 null', async () => {
    const failing = (async () =>
      ({ ok: false, json: async () => ({}) }) as unknown as Response) as unknown as typeof fetch
    expect(
      await summarizeTurnsWithLocal({
        baseUrl: 'http://127.0.0.1:1',
        model: 'm',
        turns,
        fetchImpl: failing
      })
    ).toBeNull()
    expect(
      await summarizeTurnsWithLocal({
        baseUrl: 'http://127.0.0.1:1',
        model: 'm',
        turns,
        fetchImpl: okFetch('')
      })
    ).toBeNull()
    expect(
      await summarizeTurnsWithLocal({
        baseUrl: 'http://127.0.0.1:1',
        model: 'm',
        turns,
        fetchImpl: (async () => {
          throw new Error('boom')
        }) as unknown as typeof fetch
      })
    ).toBeNull()
  })

  it('禁止重定向（回环跳远端）', async () => {
    let redirect = ''
    await summarizeTurnsWithLocal({
      baseUrl: 'http://127.0.0.1:1',
      model: 'm',
      turns,
      fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
        redirect = (init?.redirect as string) ?? ''
        return {
          ok: true,
          json: async () => ({ choices: [{ message: { content: 'x' } }] })
        } as unknown as Response
      }) as unknown as typeof fetch
    })
    expect(redirect).toBe('error')
  })
})
