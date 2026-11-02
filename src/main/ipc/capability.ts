import { dialog, ipcMain, shell } from 'electron'
import type { CapabilityCenter } from '../capabilities'
import type { AuditLog } from '../db/audit'
import type { ExternalMcpSaveInput, McpToolApproval } from '../../shared/ipc'
import { EXTERNAL_MCP_TARGETS, IPC_CHANNELS } from '../../shared/ipc'
import type { PluginSourceService } from '../capabilities/plugins/sources-service'
import type { UpdateChecker } from '../capabilities/plugins/update-checker'
import {
  copyPluginSnapshot,
  detectComponents,
  importLocal,
  scanForImport
} from '../capabilities/plugins/local-import'
import { scanClaudeLocal, scanCodexLocal } from '../capabilities/plugins/local-scan'

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
  if (
    input.targets !== undefined &&
    !EXTERNAL_MCP_TARGETS.includes(input.targets as (typeof EXTERNAL_MCP_TARGETS)[number])
  ) {
    throw new TypeError('Agent 归属无效')
  }
  return input as unknown as ExternalMcpSaveInput
}

function describe(input: ExternalMcpSaveInput): string {
  if (input.catalogId) return `catalog:${input.catalogId}`
  const base =
    input.transport === 'http' ? `http:${input.url ?? ''}` : `stdio:${input.command ?? ''}`
  return input.targets && input.targets !== 'both' ? `${base} for=${input.targets}` : base
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

  ipcMain.handle(IPC.capabilityBuiltinToolSet, (_event, name: unknown, enabled: unknown) => {
    const tool = assertId(name, '工具名')
    const next = assertBoolean(enabled, '工具状态')
    const tools = center.setBuiltinTool(tool, next)
    record('builtin-tool', `${tool} → ${next ? 'enabled' : 'disabled'}`)
    return tools
  })

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

/**
 * 插件源、本机扫描与更新检查的 IPC。
 * 与能力中心分开注册，避免 registerCapabilityHandlers 的签名继续膨胀。
 */
export function registerPluginHandlers(
  center: CapabilityCenter,
  sources: PluginSourceService,
  checker: UpdateChecker,
  audit?: AuditLog
): void {
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

  ipcMain.handle(IPC.capabilityPluginSources, () => sources.list())

  ipcMain.handle(IPC.capabilityPluginSourceAdd, async (_event, value: unknown) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new TypeError('插件源参数无效')
    }
    const input = value as Record<string, unknown>
    const name = typeof input.name === 'string' ? input.name : ''
    const url = typeof input.url === 'string' ? input.url : ''
    const ref = typeof input.ref === 'string' ? input.ref : ''
    if (!name || name.length > 60) throw new TypeError('源名称无效')
    if (!url || url.length > 2000) throw new TypeError('源地址无效')
    const saved = await sources.add({ name, url, ref })
    record('plugin-source.add', `${saved.name} · ${saved.url}`)
    return saved
  })

  ipcMain.handle(IPC.capabilityPluginSourceRefresh, async (_event, id: unknown) => {
    const target = assertId(id, '源 id')
    const result = await sources.refresh(target)
    record('plugin-source.refresh', `${result.source.name} · ${result.plugins.length} plugins`)
    return result.source
  })

  ipcMain.handle(IPC.capabilityPluginSourceRemove, async (_event, id: unknown) => {
    const target = assertId(id, '源 id')
    await sources.remove(target)
    record('plugin-source.remove', target)
  })

  ipcMain.handle(IPC.capabilityPluginScanLocal, () => scanForImport())

  ipcMain.handle(IPC.capabilityPluginImport, async (_event, value: unknown) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new TypeError('导入参数无效')
    }
    const input = value as Record<string, unknown>
    const agent = input.agent === 'codex' ? 'codex' : input.agent === 'claude' ? 'claude' : null
    if (!agent) throw new TypeError('Agent 无效')
    const markets = Array.isArray(input.markets)
      ? input.markets.filter((item): item is string => typeof item === 'string')
      : []
    const plugins = Array.isArray(input.plugins)
      ? input.plugins.filter((item): item is string => typeof item === 'string')
      : []
    const scan = agent === 'claude' ? scanClaudeLocal() : scanCodexLocal()
    const outcome = await importLocal({ agent, markets, plugins }, scan, {
      repository: center.repository,
      agentDir: center.agentDir,
      codexHome: center.codexHome,
      registerMarket: (market, root) => sources.register(market, root),
      installFromDirectory: (target, source, meta) => {
        const dir = copyPluginSnapshot(
          target,
          source,
          {
            agentDir: center.agentDir,
            codexHome: center.codexHome
          },
          {
            id: meta.id,
            name: meta.name,
            market: meta.market,
            version: meta.version,
            enabled: false,
            installPath: source
          }
        )
        const detected = detectComponents(dir)
        center.repository.upsertPlugin({
          id: meta.id,
          name: meta.name,
          description: '',
          version: meta.version,
          marketplace: meta.market,
          installPath: dir,
          components: detected.components,
          hasHooks: detected.hasHooks,
          hasMcp: detected.hasMcp,
          enabled: false,
          trusted: false,
          agent: target
        })
      }
    })
    record(
      'plugin.import',
      `${agent} · ${outcome.importedMarkets.length} markets / ${outcome.importedPlugins.length} plugins`
    )
    return outcome
  })

  ipcMain.handle(IPC.capabilityUpdatesCheck, () => checker.check())
}

export const capabilityHandlerIPC = {
  assertId,
  assertSaveInput
} as const
