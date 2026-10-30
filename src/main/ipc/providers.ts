import { ipcMain } from 'electron'
import type {
  ProviderSaveInput,
  ProviderTarget,
  ProviderTestInput,
  ProviderWireApi
} from '../../shared/ipc'
import { IPC_CHANNELS } from '../../shared/ipc'
import type { ProviderService } from '../providers'

const IPC = IPC_CHANNELS
const MAX_ID = 120
const MAX_NAME = 80
const MAX_URL = 500
const MAX_MODEL = 120
const MAX_KEY = 500

function text(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') throw new TypeError(`${label}无效`)
  const trimmed = value.trim()
  if (!trimmed) throw new TypeError(`${label}不能为空`)
  if (trimmed.length > max) throw new TypeError(`${label}过长`)
  return trimmed
}

function assertSaveInput(value: unknown): ProviderSaveInput {
  if (typeof value !== 'object' || value === null) throw new TypeError('Provider 参数必须是对象')
  const connection = assertConnectionFields(value as Record<string, unknown>)
  return {
    ...connection,
    name: text((value as Record<string, unknown>).name, '名称', MAX_NAME)
  }
}

function assertTestInput(value: unknown): ProviderTestInput {
  if (typeof value !== 'object' || value === null) throw new TypeError('Provider 参数必须是对象')
  return assertConnectionFields(value as Record<string, unknown>)
}

function assertConnectionFields(input: Record<string, unknown>): ProviderTestInput {
  const baseUrl = text(input.baseUrl, 'Base URL', MAX_URL)
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new TypeError('Base URL 无效')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new TypeError('Base URL 只支持 http(s)')
  }

  const target = assertTarget(input.target)
  const wireApi = assertWireApi(input.wireApi)
  // Codex CLI 0.166 起移除了 Chat Completions 适配，只接受 Responses。
  if (target === 'codex' && wireApi !== 'responses') {
    throw new TypeError('当前 Codex CLI 只支持 Responses 协议')
  }

  const result: ProviderTestInput = {
    target,
    wireApi,
    baseUrl,
    model: text(input.model, '模型', MAX_MODEL)
  }
  if (input.id !== undefined) result.id = text(input.id, 'Provider id', MAX_ID)
  if (input.apiKey !== undefined) {
    if (typeof input.apiKey !== 'string') throw new TypeError('API Key 无效')
    const apiKey = input.apiKey.trim()
    if (apiKey.length > MAX_KEY) throw new TypeError('API Key 过长')
    if (apiKey) result.apiKey = apiKey
  }
  return result
}

function assertTarget(value: unknown): ProviderTarget {
  if (value !== 'claude' && value !== 'codex') throw new TypeError('Provider 目标无效')
  return value
}

function assertWireApi(value: unknown): ProviderWireApi {
  if (value !== 'responses' && value !== 'chat') throw new TypeError('Provider 协议无效')
  return value
}

function assertActiveId(value: unknown): string | null {
  if (value === null) return null
  return text(value, 'Provider id', MAX_ID)
}

export const providerValidators = {
  assertSaveInput,
  assertTestInput,
  assertActiveId,
  assertTarget,
  assertWireApi
}

export function registerProviderHandlers(service: ProviderService): void {
  ipcMain.handle(IPC.providerList, () => service.list())
  ipcMain.handle(IPC.providerSave, (_event, value: unknown) => service.save(assertSaveInput(value)))
  ipcMain.handle(IPC.providerSetActive, (_event, target: unknown, value: unknown) => {
    service.setActive(assertTarget(target), assertActiveId(value))
  })
  ipcMain.handle(IPC.providerTest, (_event, value: unknown) =>
    service.testConnection(assertTestInput(value))
  )
}
