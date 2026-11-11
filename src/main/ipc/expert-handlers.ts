import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import type { CapabilityCenter } from '../capabilities'
import { ExpertMarketService } from '../capabilities/expert-market'
import { ExpertService } from '../capabilities/experts'
import { enablePluginForAgent } from '../capabilities/plugins/enable'
import type { AuditLog } from '../db/audit'
import type { ExpertRepository } from '../db/experts'
import { IPC_CHANNELS } from '../../shared/ipc'
import {
  assertExpertActivateInput,
  assertExpertId,
  assertExpertMarketImportInput,
  assertExpertMarkdown,
  assertExpertSaveInput,
  assertExpertSourceInput
} from './expert-validators'
import { recordSettings } from './settings-audit'

const IPC = IPC_CHANNELS

export interface ExpertHandlerOptions {
  center: CapabilityCenter
  experts: ExpertRepository
  appDataDir: string
  audit?: AuditLog
  getWindow: () => BrowserWindow | null
}

/** 专家与轻量市场的 IPC；激活只启用已信任 MCP / 已装技能，不自动信任。 */
export function registerExpertHandlers(options: ExpertHandlerOptions): void {
  const { center, experts, appDataDir, audit, getWindow } = options
  const service = new ExpertService({
    repository: experts,
    trustedMcpIds: (agent) =>
      center.mcp
        .list()
        .filter(
          (server) => server.trusted && (server.targets === 'both' || server.targets === agent)
        )
        .map((server) => server.id),
    installedSkillIds: (agent) => center.repository.listPlugins(agent).map((plugin) => plugin.id),
    enableMcp: (id) => {
      center.mcp.setEnabled(id, true)
    },
    enableSkill: (id, agent) => enablePluginForAgent(center, id, agent, true),
    setPreferred: (agent, key) => {
      center.toolSurface.setPreferred(agent, key, true)
    },
    writeExport: async (defaultName, content) => {
      const forced = process.env.WS_EXPORT_PATH?.trim()
      let filePath = forced ?? ''
      if (!filePath) {
        const dialogOptions = {
          title: '导出专家',
          defaultPath: defaultName,
          filters: [{ name: 'Markdown 文件', extensions: ['md'] }]
        }
        const win = getWindow()
        const picked = win
          ? await dialog.showSaveDialog(win, dialogOptions)
          : await dialog.showSaveDialog(dialogOptions)
        if (picked.canceled || !picked.filePath) return { canceled: true }
        filePath = picked.filePath
      }
      await writeFile(filePath, content, 'utf8')
      return { canceled: false, path: filePath, count: 1 }
    }
  })
  const market = new ExpertMarketService({
    repository: experts,
    appDataDir,
    importMarkdown: (text) => service.importMarkdown(text)
  })
  const record = (title: string, detail: string, targetId?: string) =>
    recordSettings(audit, title, detail, targetId)

  ipcMain.handle(IPC.expertsList, () => service.list())
  ipcMain.handle(IPC.expertsSave, (_event, value: unknown) => {
    const saved = service.save(assertExpertSaveInput(value))
    record('专家保存', saved.name, saved.id)
    return saved
  })
  ipcMain.handle(IPC.expertsRemove, (_event, value: unknown) => {
    const id = assertExpertId(value, '专家 id')
    const removed = service.remove(id)
    record('专家删除', id)
    return removed
  })
  ipcMain.handle(IPC.expertsImport, (_event, value: unknown) => {
    const saved = service.importMarkdown(assertExpertMarkdown(value))
    record('专家导入', saved.name, saved.id)
    return saved
  })
  ipcMain.handle(IPC.expertsExport, (_event, value: unknown) =>
    service.export(assertExpertId(value, '专家 id'))
  )
  ipcMain.handle(IPC.expertsActivate, (_event, value: unknown) => {
    const { agent, id } = assertExpertActivateInput(value)
    const result = service.activate(agent, id)
    record(
      '专家激活',
      `${agent} · ${id} · 启用 ${result.applied.length} / 缺失 ${result.missing.length}`,
      id
    )
    return result
  })

  ipcMain.handle(IPC.expertMarketSources, () => market.sources())
  ipcMain.handle(IPC.expertMarketAddSource, async (_event, value: unknown) => {
    const source = await market.addSource(assertExpertSourceInput(value))
    record('专家源添加', source.name, source.id)
    return source
  })
  ipcMain.handle(IPC.expertMarketRemoveSource, (_event, value: unknown) => {
    const id = assertExpertId(value, '源 id')
    market.removeSource(id)
    record('专家源移除', id)
  })
  ipcMain.handle(IPC.expertMarketRefresh, async (_event, value: unknown) => {
    const source = await market.refresh(assertExpertId(value, '源 id'))
    record('专家源刷新', source.name, source.id)
    return source
  })
  ipcMain.handle(IPC.expertMarketList, () => market.list())
  ipcMain.handle(IPC.expertMarketImport, (_event, value: unknown) => {
    const { sourceId, relPath } = assertExpertMarketImportInput(value)
    const saved = market.importEntry(sourceId, relPath)
    record('市场专家导入', saved.name, saved.id)
    return saved
  })
}
