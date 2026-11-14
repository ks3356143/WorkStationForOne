import { ipcMain } from 'electron'
import type { PromptTemplateRepository } from '../db/prompt-templates'
import { IPC_CHANNELS } from '../../shared/ipc'

const IPC = IPC_CHANNELS

function assertId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('模板 id 无效')
  return value
}

function assertSaveInput(value: unknown): { id?: string; name: string; body: string } {
  const input = (value ?? {}) as Record<string, unknown>
  if (typeof input.name !== 'string') throw new TypeError('模板名称无效')
  if (typeof input.body !== 'string') throw new TypeError('模板正文无效')
  const id = input.id === undefined ? undefined : assertId(input.id)
  return { ...(id ? { id } : {}), name: input.name, body: input.body }
}

/** Composer `/` 提示词模板的 IPC。 */
export function registerPromptHandlers(prompts: PromptTemplateRepository): void {
  ipcMain.handle(IPC.promptsList, () => prompts.list())
  ipcMain.handle(IPC.promptsSave, (_event, value: unknown) => prompts.save(assertSaveInput(value)))
  ipcMain.handle(IPC.promptsRemove, (_event, value: unknown) => prompts.remove(assertId(value)))
}

export const promptHandlerValidators = { assertId, assertSaveInput }
