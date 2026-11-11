import { describe, expect, it } from 'vitest'
import type { ProviderProfileRecord } from '../../../shared/ipc'
import { activeProviderLabel } from './provider-label'

function profile(
  id: string,
  target: 'claude' | 'codex',
  active: boolean,
  model: string
): ProviderProfileRecord {
  return {
    id,
    name: 'DeepSeek',
    target,
    wireApi: 'responses',
    baseUrl: 'https://api.deepseek.com',
    model,
    hasToken: true,
    priority: 0,
    active,
    createdAt: 1,
    updatedAt: 1
  }
}

describe('Provider 标签', () => {
  it('按目标取激活配置', () => {
    const profiles = [
      profile('c1', 'claude', true, 'deepseek-flash'),
      profile('x1', 'codex', false, 'deepseek-flash')
    ]
    expect(activeProviderLabel(profiles, 'claude')).toBe('DeepSeek · deepseek-flash')
    expect(activeProviderLabel(profiles, 'codex')).toBeUndefined()
  })

  it('没有激活配置时返回 undefined，界面继续显示 CLI', () => {
    expect(activeProviderLabel([], 'claude')).toBeUndefined()
    expect(activeProviderLabel([profile('c2', 'claude', false, 'x')], 'claude')).toBeUndefined()
  })
})
