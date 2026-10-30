import { dialog, ipcMain, shell } from 'electron'
import type { CapabilityCenter } from '../capabilities'
import type { AuditLog } from '../db/audit'
import type { ExternalMcpSaveInput, McpToolApproval } from '../../shared/ipc'
import { IPC_CHANNELS } from '../../shared/ipc'

const IPC = IPC_CHANNELS
const MAX_ID = 240

function assertId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID) {
    throw new TypeError(`${label}无效`)
  }
  return value
}

function assertBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label}无效`)
  return value
}

function assertOptionalBoolean(value: unknown): boolean {
  return value === true
}

function assertSaveInput(value: unknown): ExternalMcpSaveInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('MCP 配置必须是对象')
  }
  const input = value as Record<string, unknown>
  if (typeof input.name !== 'string') throw new TypeError('MCP 名称无效')
  if (input.transport !== 'stdio' && input.transport !== 'http') {
    throw new TypeError('传输方式无效')
  }
  if (input.args !== undefined && !Array.isArray(input.args)) {
    throw new TypeError('MCP 参数无效')
  }
  for (const key of ['env', 'headers'] as const) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'object' || input[key] === null || Array.isArray(input[key])) {
        throw new TypeError(key === 'env' ? '环境变量无效' : 'Header 无效')
      }
    }
  }
  return input as unknown as ExternalMcpSaveInput
}

function describe(input: ExternalMcpSaveInput): string {
  if (input.catalogId) return `catalog:${input.catalogId}`
  return input.transport === 'http' ? `http:${input.url ?? ''}` : `stdio:${input.command ?? ''}`
}

/**
 * 能力中心 IPC：只操作应用私有库与应用私有插件目录；
 * 审计只记录标题与配置摘要，不记录 env / header 的值。
 */
export function registerCapabilityHandlers(center: CapabilityCenter, audit?: AuditLog): void {
  const record = (title: string, detail: string) => {
    audit?.record({
      at: Date.now(),
      domain: 'system',
      action: 'settings',
      title,
      source: 'ui',
      detail
    })
  }

  ipcMain.handle(IPC.capabilityBuiltinTools, () => center.builtinTools())

  ipcMain.handle(IPC.capabilityEnvironment, (_event, force: unknown) =>
    center.environment(force === true)
  )

  ipcMain.handle(IPC.capabilitySkillsList, () => center.plugins.list())

  ipcMain.handle(IPC.capabilitySkillsMarket, (_event, force: unknown) =>
    center.plugins.market(force === true)
  )

  ipcMain.handle(IPC.capabilitySkillsInstall, async (_event, pluginId: unknown) => {
    const id = assertId(pluginId, '插件 id')
    const installed = await center.plugins.install(id)
    record('skill.install', id)
    return installed
  })

  ipcMain.handle(IPC.capabilitySkillsUpdate, async (_event, pluginId: unknown) => {
    const id = assertId(pluginId, '插件 id')
    const updated = await center.plugins.update(id)
    record('skill.update', id)
    return updated
  })

  ipcMain.handle(IPC.capabilitySkillsRemove, async (_event, pluginId: unknown) => {
    const id = assertId(pluginId, '插件 id')
    await center.plugins.remove(id)
    record('skill.remove', id)
  })

  ipcMain.handle(IPC.capabilitySkillsImportLocal, async () => {
    let source = process.env.WS_PICK_SKILL?.trim() ?? ''
    if (!source) {
      const result = await dialog.showOpenDialog({
        title: '导入本地技能或插件目录',
        properties: ['openDirectory']
      })
      if (result.canceled || !result.filePaths[0]) return null
      source = result.filePaths[0]
    }
    const plugin = center.plugins.importLocal(source)
    record('skill.import-local', `${plugin.name} · ${plugin.id}`)
    return plugin
  })

  ipcMain.handle(IPC.capabilitySkillsInspect, (_event, pluginId: unknown) =>
    center.plugins.inspectSkill(assertId(pluginId, '插件 id'))
  )

  ipcMain.handle(IPC.capabilitySkillsOpenFolder, async (_event, pluginId: unknown) => {
    const folder = center.plugins.folderFor(assertId(pluginId, '插件 id'))
    const error = await shell.openPath(folder)
    if (error) throw new Error(error)
  })

  ipcMain.handle(
    IPC.capabilitySkillsSetEnabled,
    (_event, pluginId: unknown, enabled: unknown, trust: unknown) => {
      const id = assertId(pluginId, '插件 id')
      const next = assertBoolean(enabled, '插件状态')
      const updated = center.plugins.setEnabled(id, next, assertOptionalBoolean(trust))
      record(next ? 'skill.enable' : 'skill.disable', id)
      return updated
    }
  )

  ipcMain.handle(IPC.capabilityMcpList, () => center.mcp.list())

  ipcMain.handle(IPC.capabilityMcpCatalog, () => center.mcp.catalog())

  ipcMain.handle(IPC.capabilityMcpAdd, (_event, value: unknown) => {
    const input = assertSaveInput(value)
    const created = center.mcp.add(input)
    record('mcp.add', `${created.name} · ${describe(input)}`)
    return created
  })

  ipcMain.handle(IPC.capabilityMcpUpdate, (_event, id: unknown, value: unknown) => {
    const target = assertId(id, 'MCP Server id')
    const input = assertSaveInput(value)
    const updated = center.mcp.update(target, input)
    record('mcp.update', `${updated.name} · ${describe(input)}`)
    return updated
  })

  ipcMain.handle(IPC.capabilityMcpRemove, (_event, id: unknown) => {
    const target = assertId(id, 'MCP Server id')
    center.mcp.remove(target)
    record('mcp.remove', target)
  })

  ipcMain.handle(
    IPC.capabilityMcpSetEnabled,
    (_event, id: unknown, enabled: unknown, trust: unknown) => {
      const target = assertId(id, 'MCP Server id')
      const next = assertBoolean(enabled, 'MCP 状态')
      const updated = center.mcp.setEnabled(target, next, assertOptionalBoolean(trust))
      record(next ? 'mcp.enable' : 'mcp.disable', updated.name)
      return updated
    }
  )

  ipcMain.handle(IPC.capabilityMcpTest, async (_event, id: unknown) => {
    const target = assertId(id, 'MCP Server id')
    const tested = await center.mcp.test(target)
    record(
      'mcp.test',
      tested.lastError
        ? `${tested.name} · ${tested.lastError}`
        : `${tested.name} · ${tested.toolNames.length} tools`
    )
    return tested
  })

  ipcMain.handle(
    IPC.capabilityMcpSetToolPolicy,
    (_event, id: unknown, toolName: unknown, approval: unknown) => {
      const target = assertId(id, 'MCP Server id')
      const tool = assertId(toolName, '工具名')
      if (approval !== 'allow' && approval !== 'ask' && approval !== 'deny') {
        throw new TypeError('工具权限无效')
      }
      const updated = center.mcp.setToolPolicy(target, tool, approval as McpToolApproval)
      record('mcp.tool-policy', `${updated.name} · ${tool} · ${approval}`)
      return updated
    }
  )

  ipcMain.handle(IPC.capabilityMcpImport, (_event, text: unknown) => {
    if (typeof text !== 'string') throw new TypeError('MCP 配置文本无效')
    if (text.length > 200_000) throw new TypeError('MCP 配置过大')
    const result = center.mcp.importConfig(text)
    record('mcp.import', `${result.added.length} added / ${result.skipped.length} skipped`)
    return result
  })

  ipcMain.handle(IPC.capabilityMcpExport, () => center.mcp.exportConfig())

  ipcMain.handle(IPC.capabilityMcpCheckUpdates, () => center.mcp.checkUpdates())

  ipcMain.handle(IPC.capabilityMcpApplyUpdate, async (_event, id: unknown) => {
    const target = assertId(id, 'MCP Server id')
    const updated = await center.mcp.applyUpdate(target)
    record('mcp.update', `${updated.name} · ${updated.version}`)
    return updated
  })
}

export const capabilityHandlerIPC = {
  assertId,
  assertSaveInput
} as const
