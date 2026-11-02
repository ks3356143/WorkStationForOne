import { Fragment, useEffect, useMemo, useState } from 'react'
import type {
  BuiltinToolRecord,
  EnvironmentCheckRecord,
  ExternalMcpCatalogEntry,
  ExternalMcpSaveInput,
  ExternalMcpServerRecord,
  ExternalMcpTargets,
  ExternalMcpUpdateInfo,
  InstalledPluginRecord,
  LocalScanRecord,
  PluginSourceRecord,
  UpdateCandidateRecord,
  McpToolApproval,
  SkillInspection,
  SkillMarketSnapshot,
  SkillRecord
} from '../../../../shared/ipc'
import {
  filterMarket,
  formatCount,
  installedCatalogIds,
  keyPlaceholders,
  marketLabel,
  mcpTarget,
  parseKeyValueLines,
  sortMarket
} from '../../lib/capabilities'

interface CapabilityPanelProps {
  notify: (text: string) => void
}

type PanelTab = 'skills' | 'mcp' | 'tools'
type SkillTab = 'installed' | 'market'

const DOMAIN_LABELS = {
  task: '任务',
  habit: '习惯',
  learning: '学习',
  note: '笔记'
} as const

/** CLI 自带工具：应用无法关闭，只能经审批卡与审批规则约束。 */
const NATIVE_TOOLS = [
  { name: 'Read / Grep / Glob / LS', description: '读取工作区文件', kind: '只读' },
  { name: 'Write / Edit / NotebookEdit', description: '修改工作区文件', kind: '写入' },
  { name: 'Bash / Shell', description: '执行命令', kind: '敏感' },
  { name: 'WebFetch / WebSearch', description: '访问外部网络', kind: '敏感' }
] as const

/** 把 enabled + trusted 压成一句可读状态，避免用户猜「还差哪一步」。 */
function mcpStatus(server: ExternalMcpServerRecord): string {
  if (!server.trusted) return '待信任'
  if (!server.enabled) return '已停用'
  if (server.lastError) return '连接失败'
  if (server.tools.length === 0) return '待测试'
  return `已连接 · ${server.tools.length} 工具`
}

const COMPONENT_LABELS: Record<string, string> = {
  skills: '技能',
  commands: '命令',
  agents: '子代理',
  hooks: 'hooks',
  mcp: 'MCP'
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

interface McpFormState {
  id?: string
  name: string
  description: string
  transport: 'stdio' | 'http'
  command: string
  args: string
  url: string
  env: string
  headers: string
  targets: ExternalMcpTargets
}

const TARGET_LABELS: Record<ExternalMcpTargets, string> = {
  both: 'Claude + Codex',
  claude: '仅 Claude',
  codex: '仅 Codex'
}

function envVersion(version: string, command: string): string {
  if (!version) return ''
  let text = version.trim()
  for (const prefix of [`${command}-cli `, `${command} version `, `${command} `]) {
    if (text.toLowerCase().startsWith(prefix.toLowerCase())) {
      text = text.slice(prefix.length)
      break
    }
  }
  return text.split(/\s+/)[0]?.slice(0, 18) ?? ''
}

const EMPTY_FORM: McpFormState = {
  name: '',
  description: '',
  transport: 'stdio',
  command: '',
  args: '',
  url: '',
  env: '',
  headers: '',
  targets: 'both'
}

function formFromServer(server: ExternalMcpServerRecord): McpFormState {
  return {
    id: server.id,
    name: server.name,
    description: server.description,
    transport: server.transport,
    command: server.command,
    args: server.args.join('\n'),
    url: server.url,
    env: keyPlaceholders(server.envKeys),
    headers: keyPlaceholders(server.headerKeys),
    targets: server.targets
  }
}

export function CapabilityPanel({ notify }: CapabilityPanelProps) {
  const api = typeof window === 'undefined' ? undefined : window.ws?.capability
  const [tab, setTab] = useState<PanelTab>('skills')
  const [skillTab, setSkillTab] = useState<SkillTab>('installed')
  const [skills, setSkills] = useState<SkillRecord[]>([])
  const [market, setMarket] = useState<SkillMarketSnapshot | null>(null)
  const [marketBusy, setMarketBusy] = useState(false)
  const [marketQuery, setMarketQuery] = useState('')
  const [marketSort, setMarketSort] = useState<'popular' | 'name'>('popular')
  const [marketLimit, setMarketLimit] = useState(48)
  const [skillsBusy, setSkillsBusy] = useState<string | null>(null)
  const [skillDetailId, setSkillDetailId] = useState('')
  const [skillInspection, setSkillInspection] = useState<SkillInspection | null>(null)
  const [detailBusy, setDetailBusy] = useState(false)
  const [mcp, setMcp] = useState<ExternalMcpServerRecord[]>([])
  const [catalog, setCatalog] = useState<ExternalMcpCatalogEntry[]>([])
  const [tools, setTools] = useState<BuiltinToolRecord[]>([])
  const [environment, setEnvironment] = useState<EnvironmentCheckRecord[]>([])
  const [envBusy, setEnvBusy] = useState(false)
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({})
  const [jsonMode, setJsonMode] = useState<'import' | 'export' | null>(null)
  const [jsonText, setJsonText] = useState('')
  const [jsonMessage, setJsonMessage] = useState<string | null>(null)
  const [jsonBusy, setJsonBusy] = useState(false)
  const [mcpBusy, setMcpBusy] = useState<string | null>(null)
  const [builtinBusy, setBuiltinBusy] = useState<string | null>(null)
  const [sources, setSources] = useState<PluginSourceRecord[]>([])
  const [sourceBusy, setSourceBusy] = useState<string | null>(null)
  const [sourceForm, setSourceForm] = useState<{ name: string; url: string; ref: string } | null>(
    null
  )
  const [scan, setScan] = useState<LocalScanRecord[] | null>(null)
  const [scanBusy, setScanBusy] = useState(false)
  const [importSel, setImportSel] = useState<{ markets: string[]; plugins: string[] }>({
    markets: [],
    plugins: []
  })
  const [pendingUpdates, setPendingUpdates] = useState<UpdateCandidateRecord[]>([])
  const [installedCodex, setInstalledCodex] = useState<InstalledPluginRecord[]>([])
  const [installedAgent, setInstalledAgent] = useState<'all' | 'claude' | 'codex'>('all')
  const [pluginOpsBusy, setPluginOpsBusy] = useState<string | null>(null)
  const [updates, setUpdates] = useState<ExternalMcpUpdateInfo[]>([])
  const [updatesBusy, setUpdatesBusy] = useState(false)
  const [form, setForm] = useState<McpFormState | null>(null)
  const [confirmKey, setConfirmKey] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!api) return
    let alive = true
    void Promise.all([api.skills.list(), api.mcp.list(), api.mcp.catalog(), api.builtinTools()])
      .then(([nextSkills, nextMcp, nextCatalog, nextTools]) => {
        if (!alive) return
        setSkills(nextSkills)
        setMcp(nextMcp)
        setCatalog(nextCatalog)
        setTools(nextTools)
      })
      .catch((reason: unknown) => {
        if (alive) setError(errorText(reason, '能力中心读取失败'))
      })
    // 环境自检会 spawn 六次 --version，不能拖慢能力列表的首屏；单独加载
    void api
      .environment()
      .then((nextEnvironment) => {
        if (alive) setEnvironment(nextEnvironment)
      })
      .catch(() => {
        if (alive) setEnvironment([])
      })
    // 插件源与启动更新结果：源列表独立加载，不阻塞首屏
    void api
      .pluginSources()
      .then((list) => {
        if (alive) setSources(list)
      })
      .catch(() => {
        if (alive) setSources([])
      })
    void api
      .installedPlugins()
      .then((list) => {
        if (alive) setInstalledCodex(list.filter((item) => item.agent === 'codex'))
      })
      .catch(() => {
        if (alive) setInstalledCodex([])
      })
    const offUpdates = api.onUpdateAvailable?.((list) => {
      if (alive) setPendingUpdates(list)
    })
    return () => {
      alive = false
      offUpdates?.()
    }
  }, [api])

  const installedCatalog = useMemo(() => installedCatalogIds(mcp), [mcp])
  const filteredMarket = useMemo(
    () => sortMarket(filterMarket(market?.entries ?? [], marketQuery), marketSort),
    [market, marketQuery, marketSort]
  )
  const visibleMarket = filteredMarket.slice(0, marketLimit)

  const loadMarket = (force: boolean) => {
    if (!api || marketBusy) return
    setMarketBusy(true)
    setError(null)
    void api.skills
      .market(force)
      .then((snapshot) => {
        setMarket(snapshot)
        setMarketLimit(48)
        if (snapshot.error) notify(`市场刷新失败：${snapshot.error}`)
      })
      .catch((reason: unknown) => setError(errorText(reason, 'Claude 市场读取失败')))
      .finally(() => setMarketBusy(false))
  }

  const loadEnvironment = (force: boolean) => {
    if (!api || envBusy) return
    setEnvBusy(true)
    void api
      .environment(force)
      .then(setEnvironment)
      .catch((reason: unknown) => notify(errorText(reason, '环境检查失败')))
      .finally(() => setEnvBusy(false))
  }

  const toggleTools = (server: ExternalMcpServerRecord) => {
    setExpandedTools((current) => ({ ...current, [server.id]: !current[server.id] }))
  }

  const changeToolPolicy = (
    server: ExternalMcpServerRecord,
    toolName: string,
    approval: McpToolApproval
  ) => {
    if (!api || mcpBusy) return
    setMcpBusy(server.id)
    void api.mcp
      .setToolPolicy(server.id, toolName, approval)
      .then((updated) => {
        setMcp((list) => list.map((item) => (item.id === updated.id ? updated : item)))
        notify(
          `${toolName}：${approval === 'allow' ? '自动批准' : approval === 'deny' ? '禁止' : '每次询问'}`
        )
      })
      .catch((reason: unknown) => notify(errorText(reason, '工具权限更新失败')))
      .finally(() => setMcpBusy(null))
  }

  const openImport = () => {
    if (!api) return
    setJsonMode('import')
    setJsonMessage(null)
    setJsonText(
      '{\n  "mcpServers": {\n    "example": {\n      "command": "npx",\n      "args": ["-y", "@modelcontextprotocol/server-memory"]\n    }\n  }\n}'
    )
  }

  const openExport = () => {
    if (!api || jsonBusy) return
    setJsonBusy(true)
    setJsonMode('export')
    setJsonMessage(null)
    setJsonText('')
    void api.mcp
      .exportConfig()
      .then((text) => setJsonText(text))
      .catch((reason: unknown) => {
        setJsonMode(null)
        notify(errorText(reason, '导出 MCP 配置失败'))
      })
      .finally(() => setJsonBusy(false))
  }

  const runImport = () => {
    if (!api || jsonBusy) return
    setJsonBusy(true)
    setJsonMessage(null)
    void api.mcp
      .importConfig(jsonText)
      .then(async (result) => {
        const next = await api.mcp.list()
        setMcp(next)
        const firstError = result.errors[0]
        const parts = [
          `已导入 ${result.added.length} 个`,
          result.skipped.length > 0 ? `跳过 ${result.skipped.length} 个重名` : '',
          result.errors.length > 0
            ? `${result.errors.length} 个错误${firstError ? `（${firstError.name}: ${firstError.message}）` : ''}`
            : ''
        ].filter(Boolean)
        setJsonMessage(parts.join(' · '))
        notify(parts.join(' · '))
        if (result.added.length > 0) setJsonMode(null)
      })
      .catch((reason: unknown) => notify(errorText(reason, '导入 MCP 配置失败')))
      .finally(() => setJsonBusy(false))
  }

  const selectJson = () => {
    const textarea = document.querySelector<HTMLTextAreaElement>('.w1-capjson')
    textarea?.focus()
    textarea?.select()
  }

  const toggleSkill = (skill: SkillRecord, enable: boolean) => {
    if (!api || skillsBusy) return
    const risky = (skill.hasHooks || skill.hasMcp) && !skill.trusted
    if (enable && risky && confirmKey !== `trust:skill:${skill.id}`) {
      setConfirmKey(`trust:skill:${skill.id}`)
      notify(`再次点击确认信任 ${skill.name} 的 hooks / MCP 组件`)
      return
    }
    setConfirmKey('')
    setSkillsBusy(skill.id)
    void api.skills
      .setEnabled(skill.id, enable, enable && risky)
      .then((updated) => {
        setSkills((list) => list.map((item) => (item.id === updated.id ? updated : item)))
        notify(enable ? `已启用 ${updated.name}` : `已停用 ${updated.name}`)
      })
      .catch((reason: unknown) => notify(errorText(reason, '插件状态更新失败')))
      .finally(() => setSkillsBusy(null))
  }

  const installSkill = (pluginId: string) => {
    if (!api || skillsBusy) return
    setSkillsBusy(pluginId)
    void api.skills
      .install(pluginId)
      .then((installed) => {
        setSkills((list) => [installed, ...list.filter((item) => item.id !== installed.id)])
        setMarket((snapshot) =>
          snapshot
            ? {
                ...snapshot,
                entries: snapshot.entries.map((entry) =>
                  entry.pluginId === installed.id ? { ...entry, installed: true } : entry
                )
              }
            : snapshot
        )
        notify(`已安装 ${installed.name} · 在已安装里启用后才会加载`)
      })
      .catch((reason: unknown) => notify(errorText(reason, '插件安装失败')))
      .finally(() => setSkillsBusy(null))
  }

  const importLocalSkill = () => {
    if (!api || skillsBusy) return
    setSkillsBusy('local')
    void api.skills
      .importLocal()
      .then((plugin) => {
        if (!plugin) return
        setSkills((list) => [plugin, ...list.filter((item) => item.id !== plugin.id)])
        setSkillTab('installed')
        notify(`已导入 ${plugin.name} · 启用后加载`)
      })
      .catch((reason: unknown) => notify(errorText(reason, '本地导入失败')))
      .finally(() => setSkillsBusy(null))
  }

  const toggleSkillDetail = (skill: SkillRecord) => {
    if (!api || detailBusy) return
    if (skillDetailId === skill.id) {
      setSkillDetailId('')
      setSkillInspection(null)
      return
    }
    setSkillDetailId(skill.id)
    setSkillInspection(null)
    setDetailBusy(true)
    void api.skills
      .inspect(skill.id)
      .then(setSkillInspection)
      .catch((reason: unknown) => {
        setSkillDetailId('')
        notify(errorText(reason, '读取技能文件失败'))
      })
      .finally(() => setDetailBusy(false))
  }

  const openSkillFolder = (skill: SkillRecord) => {
    if (!api) return
    void api.skills
      .openFolder(skill.id)
      .catch((reason: unknown) => notify(errorText(reason, '打开目录失败')))
  }

  const updateSkill = (skill: SkillRecord) => {
    if (!api || skillsBusy) return
    setSkillsBusy(skill.id)
    void api.skills
      .update(skill.id)
      .then((updated) => {
        setSkills((list) => list.map((item) => (item.id === updated.id ? updated : item)))
        notify(`${updated.name} 已更新到 ${updated.version || '最新版本'}`)
      })
      .catch((reason: unknown) => notify(errorText(reason, '插件更新失败')))
      .finally(() => setSkillsBusy(null))
  }

  const removeSkill = (skill: SkillRecord) => {
    if (!api || skillsBusy) return
    if (confirmKey !== `skill:${skill.id}`) {
      setConfirmKey(`skill:${skill.id}`)
      return
    }
    setConfirmKey('')
    setSkillsBusy(skill.id)
    void api.skills
      .remove(skill.id)
      .then(() => {
        setSkills((list) => list.filter((item) => item.id !== skill.id))
        if (skillDetailId === skill.id) {
          setSkillDetailId('')
          setSkillInspection(null)
        }
        setMarket((snapshot) =>
          snapshot
            ? {
                ...snapshot,
                entries: snapshot.entries.map((entry) =>
                  entry.pluginId === skill.id ? { ...entry, installed: false } : entry
                )
              }
            : snapshot
        )
        notify(`已移除 ${skill.name}`)
      })
      .catch((reason: unknown) => notify(errorText(reason, '插件移除失败')))
      .finally(() => setSkillsBusy(null))
  }

  const loadInstalledPlugins = () => {
    if (!api) return
    void api
      .installedPlugins()
      .then((list) => setInstalledCodex(list.filter((item) => item.agent === 'codex')))
      .catch(() => setInstalledCodex([]))
  }

  const toggleCodexPlugin = (plugin: InstalledPluginRecord) => {
    if (!api || pluginOpsBusy) return
    setPluginOpsBusy(plugin.id)
    void api
      .setPluginEnabled({ id: plugin.id, agent: 'codex', enabled: !plugin.enabled })
      .then(() => {
        notify(`${plugin.name} 已${plugin.enabled ? '停用' : '启用'} · 下一次会话生效`)
        loadInstalledPlugins()
      })
      .catch((reason: unknown) => notify(errorText(reason, '插件启停失败')))
      .finally(() => setPluginOpsBusy(null))
  }

  const removeCodexPlugin = (plugin: InstalledPluginRecord) => {
    if (!api || pluginOpsBusy) return
    if (confirmKey !== `plug:${plugin.id}`) {
      setConfirmKey(`plug:${plugin.id}`)
      return
    }
    setConfirmKey('')
    setPluginOpsBusy(plugin.id)
    void api
      .removePlugin({ id: plugin.id, agent: 'codex' })
      .then(() => {
        notify(`已卸载 ${plugin.name}`)
        loadInstalledPlugins()
      })
      .catch((reason: unknown) => notify(errorText(reason, '卸载失败')))
      .finally(() => setPluginOpsBusy(null))
  }

  const addSource = () => {
    if (!api || !sourceForm || sourceBusy) return
    const name = sourceForm.name.trim()
    const url = sourceForm.url.trim()
    if (!name || !url) {
      notify('填写名称与地址')
      return
    }
    setSourceBusy('add')
    void api
      .addPluginSource({ name, url, ref: sourceForm.ref.trim() })
      .then((saved) => {
        setSources((list) => [...list, saved])
        setSourceForm(null)
        notify(`已添加源 ${saved.name} · ${saved.pluginCount} 个插件`)
      })
      .catch((reason: unknown) => notify(errorText(reason, '添加源失败')))
      .finally(() => setSourceBusy(null))
  }

  const refreshSource = (source: PluginSourceRecord) => {
    if (!api || sourceBusy) return
    setSourceBusy(source.id)
    void api
      .refreshPluginSource(source.id)
      .then((saved) => {
        setSources((list) => list.map((item) => (item.id === saved.id ? saved : item)))
        notify(`${saved.name} 已刷新 · ${saved.pluginCount} 个插件`)
      })
      .catch((reason: unknown) => notify(errorText(reason, '刷新源失败')))
      .finally(() => setSourceBusy(null))
  }

  const removeSource = (source: PluginSourceRecord) => {
    if (!api || sourceBusy) return
    setSourceBusy(source.id)
    void api
      .removePluginSource(source.id)
      .then(() => {
        setSources((list) => list.filter((item) => item.id !== source.id))
        notify(`已移除源 ${source.name}，已装插件保留`)
      })
      .catch((reason: unknown) => notify(errorText(reason, '移除源失败')))
      .finally(() => setSourceBusy(null))
  }

  const runScan = () => {
    if (!api || scanBusy) return
    setScanBusy(true)
    void api
      .scanLocalPlugins()
      .then((result) => {
        setScan(result)
        setImportSel({ markets: [], plugins: [] })
      })
      .catch((reason: unknown) => notify(errorText(reason, '本机扫描失败')))
      .finally(() => setScanBusy(false))
  }

  const toggleImport = (kind: 'markets' | 'plugins', id: string) => {
    setImportSel((current) => {
      const list = current[kind]
      return {
        ...current,
        [kind]: list.includes(id) ? list.filter((item) => item !== id) : [...list, id]
      }
    })
  }

  const runLocalImport = (agent: 'claude' | 'codex') => {
    if (!api || scanBusy) return
    const markets = importSel.markets.filter((id) =>
      scan?.find((item) => item.agent === agent)?.marketplaces.some((m) => m.name === id)
    )
    const plugins = importSel.plugins.filter((id) =>
      scan?.find((item) => item.agent === agent)?.plugins.some((p) => p.id === id)
    )
    if (markets.length === 0 && plugins.length === 0) {
      notify('先勾选要导入的市场或插件')
      return
    }
    setScanBusy(true)
    void api
      .importLocalPlugins({ agent, markets, plugins })
      .then(async (outcome) => {
        const skipped = outcome.skipped.length
        notify(
          `导入 ${outcome.importedMarkets.length} 个市场、${outcome.importedPlugins.length} 个插件${
            skipped > 0 ? ` · ${skipped} 项跳过` : ''
          }`
        )
        const [nextSkills, nextSources, nextInstalled] = await Promise.all([
          api.skills.list(),
          api.pluginSources(),
          api.installedPlugins()
        ])
        setSkills(nextSkills)
        setSources(nextSources)
        setInstalledCodex(nextInstalled.filter((item) => item.agent === 'codex'))
      })
      .catch((reason: unknown) => notify(errorText(reason, '导入失败')))
      .finally(() => setScanBusy(false))
  }

  const toggleBuiltin = (tool: BuiltinToolRecord) => {
    if (!api?.setBuiltinTool || builtinBusy) return
    setBuiltinBusy(tool.name)
    void api
      .setBuiltinTool(tool.name, !tool.enabled)
      .then((next) => {
        setTools(next)
        notify(`${tool.name} 已${tool.enabled ? '关闭' : '启用'} · 下一次会话生效`)
      })
      .catch((reason: unknown) => notify(errorText(reason, '内置工具开关失败')))
      .finally(() => setBuiltinBusy(null))
  }

  const toggleMcp = (server: ExternalMcpServerRecord, enable: boolean) => {
    if (!api || mcpBusy) return
    if (enable && !server.trusted && confirmKey !== `trust:mcp:${server.id}`) {
      setConfirmKey(`trust:mcp:${server.id}`)
      notify(`再次点击确认信任 ${server.name} 的命令与参数`)
      return
    }
    setConfirmKey('')
    setMcpBusy(server.id)
    void api.mcp
      .setEnabled(server.id, enable, enable && !server.trusted)
      .then((updated) => {
        setMcp((list) => list.map((item) => (item.id === updated.id ? updated : item)))
        notify(enable ? `已启用 ${updated.name}` : `已停用 ${updated.name}`)
      })
      .catch((reason: unknown) => notify(errorText(reason, 'MCP 状态更新失败')))
      .finally(() => setMcpBusy(null))
  }

  const testMcp = (server: ExternalMcpServerRecord) => {
    if (!api || mcpBusy) return
    setMcpBusy(server.id)
    void api.mcp
      .test(server.id)
      .then((updated) => {
        setMcp((list) => list.map((item) => (item.id === updated.id ? updated : item)))
        if (updated.lastError) notify(`${updated.name} 测试失败：${updated.lastError}`)
        else notify(`${updated.name} 连接正常 · ${updated.toolNames.length} 个工具`)
      })
      .catch((reason: unknown) => notify(errorText(reason, 'MCP 测试失败')))
      .finally(() => setMcpBusy(null))
  }

  const addCatalogServer = (entry: ExternalMcpCatalogEntry) => {
    if (!api || mcpBusy) return
    setMcpBusy(entry.id)
    void api.mcp
      .add({ name: entry.name, transport: entry.transport, catalogId: entry.id })
      .then((created) => {
        setMcp((list) => [created, ...list])
        notify(`已添加 ${created.name} · 启用前需确认信任`)
      })
      .catch((reason: unknown) => notify(errorText(reason, 'MCP 添加失败')))
      .finally(() => setMcpBusy(null))
  }

  const saveForm = () => {
    if (!api || !form || mcpBusy) return
    const input: ExternalMcpSaveInput = {
      name: form.name,
      description: form.description,
      transport: form.transport,
      targets: form.targets,
      ...(form.transport === 'stdio'
        ? {
            command: form.command,
            args: form.args
              .split(/\r?\n/)
              .map((line) => line.trim())
              .filter(Boolean)
          }
        : { url: form.url }),
      env: parseKeyValueLines(form.env),
      headers: parseKeyValueLines(form.headers)
    }
    setMcpBusy('form')
    const request = form.id ? api.mcp.update(form.id, input) : api.mcp.add(input)
    void request
      .then((saved) => {
        setMcp((list) => [saved, ...list.filter((item) => item.id !== saved.id)])
        setForm(null)
        notify(`${saved.name} 已保存 · 启用前需确认信任`)
        setUpdates((list) => list.filter((item) => item.id !== saved.id))
      })
      .catch((reason: unknown) => notify(errorText(reason, 'MCP 保存失败')))
      .finally(() => setMcpBusy(null))
  }

  const removeMcp = (server: ExternalMcpServerRecord) => {
    if (!api || mcpBusy) return
    if (confirmKey !== `mcp:${server.id}`) {
      setConfirmKey(`mcp:${server.id}`)
      return
    }
    setConfirmKey('')
    setMcpBusy(server.id)
    void api.mcp
      .remove(server.id)
      .then(() => {
        setMcp((list) => list.filter((item) => item.id !== server.id))
        setUpdates((list) => list.filter((item) => item.id !== server.id))
        notify(`已移除 ${server.name}`)
      })
      .catch((reason: unknown) => notify(errorText(reason, 'MCP 移除失败')))
      .finally(() => setMcpBusy(null))
  }

  const checkUpdates = () => {
    if (!api || updatesBusy) return
    setUpdatesBusy(true)
    void api.mcp
      .checkUpdates()
      .then((list) => {
        setUpdates(list)
        const count = list.filter((item) => item.hasUpdate).length
        notify(count > 0 ? `${count} 个 MCP 有更新` : '内置 MCP 都是最新版本')
      })
      .catch((reason: unknown) => notify(errorText(reason, '检查更新失败')))
      .finally(() => setUpdatesBusy(false))
  }

  const applyUpdate = (server: ExternalMcpServerRecord) => {
    if (!api || mcpBusy) return
    setMcpBusy(server.id)
    void api.mcp
      .applyUpdate(server.id)
      .then((updated) => {
        setMcp((list) => list.map((item) => (item.id === updated.id ? updated : item)))
        setUpdates((list) =>
          list.map((item) =>
            item.id === updated.id
              ? { ...item, currentVersion: updated.version, hasUpdate: false }
              : item
          )
        )
        notify(`${updated.name} 已更新到 ${updated.version}`)
      })
      .catch((reason: unknown) => notify(errorText(reason, 'MCP 更新失败')))
      .finally(() => setMcpBusy(null))
  }

  if (!api) {
    return (
      <div className="w1-capempty">当前环境没有 preload 桥，能力中心不可用。请从桌面应用打开。</div>
    )
  }

  return (
    <div className="w1-cap">
      {pendingUpdates.length > 0 ? (
        <div className="w1-capupdate" role="status">
          <span>
            {pendingUpdates.filter((item) => item.kind === 'plugin').length} 个插件、
            {pendingUpdates.filter((item) => item.kind === 'mcp').length} 个 MCP 可更新
          </span>
          <span className="w1-capupdateacts">
            <button
              type="button"
              className="w1-capmini pri"
              onClick={() => {
                setTab(pendingUpdates.some((item) => item.kind === 'plugin') ? 'skills' : 'mcp')
                setPendingUpdates([])
              }}
            >
              查看
            </button>
            <button type="button" className="w1-capmini" onClick={() => setPendingUpdates([])}>
              稍后
            </button>
          </span>
        </div>
      ) : null}
      <div className="w1-capnav" role="tablist" aria-label="能力中心">
        {(
          [
            ['skills', '技能 / 插件'],
            ['mcp', 'MCP 服务'],
            ['tools', '内置工具']
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            className={tab === value ? 'on' : ''}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
        <span className="w1-capscope">应用私有 · 不写全局配置</span>
      </div>

      {error ? (
        <div className="w1-caperror" role="alert">
          {error}
          <button type="button" onClick={() => setError(null)}>
            关闭
          </button>
        </div>
      ) : null}

      {tab === 'skills' ? (
        <section className="w1-capsection" aria-label="Claude 插件与技能">
          <div className="w1-caphead">
            <span className="w1-capkicker">// CLAUDE PLUGINS</span>
            <span className="w1-capnote">仅 Claude 会话生效；Codex 用下方「插件源」里的市场</span>
            <div className="w1-capactions">
              <div className="w1-capseg" role="group" aria-label="插件视图">
                <button
                  type="button"
                  className={skillTab === 'installed' ? 'on' : ''}
                  aria-pressed={skillTab === 'installed'}
                  onClick={() => setSkillTab('installed')}
                >
                  已安装 {skills.length}
                </button>
                <button
                  type="button"
                  className={skillTab === 'market' ? 'on' : ''}
                  aria-pressed={skillTab === 'market'}
                  onClick={() => {
                    setSkillTab('market')
                    if (!market) loadMarket(false)
                  }}
                >
                  市场
                </button>
              </div>
              <button
                type="button"
                className="w1-capmini"
                disabled={skillsBusy === 'local'}
                onClick={importLocalSkill}
              >
                {skillsBusy === 'local' ? '导入中…' : '本地导入'}
              </button>
            </div>
          </div>

          {/* 插件源：官方与第三方 Git 源，两个 Agent 共用同一份清单格式 */}
          <div className="w1-capsrcblock">
            <div className="w1-caphead">
              <span className="w1-capkicker">// SOURCES</span>
              <span className="w1-capnote">Claude 与 Codex 共用；只写应用私有目录</span>
              <div className="w1-capactions">
                <button type="button" className="w1-capmini" disabled={scanBusy} onClick={runScan}>
                  {scanBusy ? '扫描中…' : '从本机导入'}
                </button>
                <button
                  type="button"
                  className="w1-capmini pri"
                  onClick={() => setSourceForm({ name: '', url: '', ref: '' })}
                >
                  添加源
                </button>
              </div>
            </div>
            {sources.length === 0 ? (
              <p className="w1-capnote">还没有插件源。添加一个 Git 仓库或本地目录开始。</p>
            ) : (
              <div className="w1-caplist">
                {sources.map((source) => (
                  <div className="w1-caprow static" key={source.id}>
                    <span className="w1-capglyph">SR</span>
                    <span className="w1-capcopy">
                      <b>
                        {source.name}
                        <i className="w1-capver">{source.kind}</i>
                      </b>
                      <p title={source.url}>{source.url || '本地目录'}</p>
                      <span className="w1-captags">
                        <i>{source.pluginCount} 个插件</i>
                        {source.lastError ? (
                          <i className="warn" title={source.lastError}>
                            刷新失败
                          </i>
                        ) : null}
                      </span>
                    </span>
                    <span className="w1-capactions">
                      <button
                        type="button"
                        className="w1-capmini"
                        disabled={sourceBusy === source.id}
                        onClick={() => refreshSource(source)}
                      >
                        刷新
                      </button>
                      {source.kind === 'official' ? null : (
                        <button
                          type="button"
                          className="w1-capmini danger"
                          disabled={sourceBusy === source.id}
                          onClick={() => removeSource(source)}
                        >
                          移除
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {sourceForm ? (
              <div className="w1-capform">
                <div className="w1-capformgrid">
                  <label>
                    <span>名称</span>
                    <input
                      value={sourceForm.name}
                      aria-label="插件源名称"
                      placeholder="community"
                      onChange={(event) =>
                        setSourceForm({ ...sourceForm, name: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    <span>分支（可选）</span>
                    <input
                      value={sourceForm.ref}
                      aria-label="插件源分支"
                      placeholder="main"
                      onChange={(event) =>
                        setSourceForm({ ...sourceForm, ref: event.target.value })
                      }
                    />
                  </label>
                  <label className="wide">
                    <span>地址</span>
                    <input
                      value={sourceForm.url}
                      aria-label="插件源地址"
                      placeholder="owner/repo 或 https://github.com/owner/repo"
                      onChange={(event) =>
                        setSourceForm({ ...sourceForm, url: event.target.value })
                      }
                    />
                  </label>
                </div>
                <div className="w1-capactions">
                  <button type="button" className="w1-capmini" onClick={() => setSourceForm(null)}>
                    取消
                  </button>
                  <button
                    type="button"
                    className="w1-capmini pri"
                    disabled={sourceBusy === 'add'}
                    onClick={addSource}
                  >
                    {sourceBusy === 'add' ? '添加中…' : '添加'}
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          {/* 本机导入：只读扫描 ~/.claude 与 ~/.codex，复制进应用私有目录 */}
          {scan ? (
            <div className="w1-capsrcblock">
              <div className="w1-caphead">
                <span className="w1-capkicker">// IMPORT FROM MACHINE</span>
                <span className="w1-capnote">
                  只读扫描，不会修改 ~/.claude 或 ~/.codex；导入后默认停用
                </span>
                <div className="w1-capactions">
                  <button type="button" className="w1-capmini" onClick={() => setScan(null)}>
                    关闭
                  </button>
                </div>
              </div>
              {scan.map((result) => (
                <div className="w1-capdomain" key={result.agent}>
                  <h4>
                    {result.agent === 'claude' ? 'Claude' : 'Codex'}
                    {result.detected ? '' : '（未检测到本机配置）'}
                  </h4>
                  {result.errors.map((message) => (
                    <p className="w1-capnote warn" key={message}>
                      {message}
                    </p>
                  ))}
                  {result.marketplaces.length === 0 && result.plugins.length === 0 ? (
                    <p className="w1-capnote">没有可导入的内容。</p>
                  ) : (
                    <div className="w1-caplist">
                      {result.marketplaces.map((market) => (
                        <label className="w1-capimportrow" key={`m-${market.name}`}>
                          <input
                            type="checkbox"
                            checked={importSel.markets.includes(market.name)}
                            onChange={() => toggleImport('markets', market.name)}
                          />
                          <span>市场</span>
                          <b>{market.name}</b>
                          <i>{market.kind}</i>
                        </label>
                      ))}
                      {result.plugins.map((plugin) => (
                        <label className="w1-capimportrow" key={`p-${plugin.id}`}>
                          <input
                            type="checkbox"
                            checked={importSel.plugins.includes(plugin.id)}
                            onChange={() => toggleImport('plugins', plugin.id)}
                          />
                          <span>插件</span>
                          <b>{plugin.id}</b>
                          <i>{plugin.version || '未标注版本'}</i>
                        </label>
                      ))}
                    </div>
                  )}
                  <div className="w1-capactions">
                    <button
                      type="button"
                      className="w1-capmini pri"
                      disabled={scanBusy}
                      onClick={() => runLocalImport(result.agent)}
                    >
                      导入到应用私有目录
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {skillTab === 'installed' ? (
            <>
              <div className="w1-capseg" role="group" aria-label="已安装插件按 Agent 过滤">
                {(
                  [
                    ['all', '全部'],
                    ['claude', 'Claude'],
                    ['codex', 'Codex']
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={installedAgent === value ? 'on' : ''}
                    aria-pressed={installedAgent === value}
                    onClick={() => setInstalledAgent(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {installedCodex.length > 0 && installedAgent !== 'claude' ? (
                <div className="w1-capdomain">
                  <h4>Codex 插件</h4>
                  <div className="w1-caplist">
                    {installedCodex.map((plugin) => (
                      <Fragment key={plugin.id}>
                        <div className="w1-caprow static">
                          <span className="w1-capglyph">CX</span>
                          <span className="w1-capcopy">
                            <b>
                              {plugin.name}
                              <i className="w1-capver">{plugin.market || 'codex'}</i>
                            </b>
                            <p>
                              {plugin.version || '未标注版本'}
                              {plugin.syncedSkills.length > 0
                                ? ` · 已同步 ${plugin.syncedSkills.length} 个 skill`
                                : ''}
                            </p>
                            <span className="w1-captags">
                              <i>{plugin.enabled ? '已启用' : '已停用'}</i>
                              {plugin.adopted ? <i>从磁盘补录</i> : null}
                              {plugin.missingOnDisk ? <i className="warn">磁盘上已消失</i> : null}
                            </span>
                          </span>
                          <span className="w1-capactions">
                            <button
                              type="button"
                              className={`w1-setbtn${plugin.enabled ? ' on' : ''}`}
                              disabled={pluginOpsBusy === plugin.id}
                              onClick={() => toggleCodexPlugin(plugin)}
                            >
                              {plugin.enabled ? '已启用' : '启用'}
                            </button>
                            <button
                              type="button"
                              className={`w1-capmini${confirmKey === `plug:${plugin.id}` ? ' danger' : ''}`}
                              disabled={pluginOpsBusy === plugin.id}
                              onClick={() => removeCodexPlugin(plugin)}
                            >
                              {confirmKey === `plug:${plugin.id}` ? '确认卸载' : '卸载'}
                            </button>
                          </span>
                        </div>
                      </Fragment>
                    ))}
                  </div>
                </div>
              ) : null}
              {skills.length === 0 && installedCodex.length === 0 ? (
                <div className="w1-capemptycard">
                  <b>还没有应用私有插件。</b>
                  <p>
                    从市场安装或从本机导入后，只装进 WorkStationForOne 的目录；不会写 ~/.claude 或
                    ~/.codex。
                  </p>
                  <button
                    className="w1-pb pri"
                    type="button"
                    onClick={() => {
                      setSkillTab('market')
                      if (!market) loadMarket(false)
                    }}
                  >
                    浏览市场
                  </button>
                </div>
              ) : null}
              {skills.length === 0 || installedAgent === 'codex' ? null : (
                <div className="w1-caplist">
                  {skills.map((skill) => (
                    <Fragment key={skill.id}>
                      <div className="w1-caprow">
                        <span className="w1-capglyph">SK</span>
                        <span className="w1-capcopy">
                          <b>
                            {skill.name}
                            <i className="w1-capver">{skill.version || '—'}</i>
                          </b>
                          <p>
                            {skill.description || marketLabel(skill.marketplace)}
                            {skill.marketplace ? ` · ${marketLabel(skill.marketplace)}` : ''}
                          </p>
                          <span className="w1-captags">
                            {skill.components.map((component) => (
                              <i key={component}>{COMPONENT_LABELS[component] ?? component}</i>
                            ))}
                            {skill.hasHooks || skill.hasMcp ? (
                              <i className="warn">含执行组件 · 需信任</i>
                            ) : null}
                          </span>
                        </span>
                        <span className="w1-capactions">
                          <button
                            type="button"
                            className={`w1-setbtn${skill.enabled ? ' on' : ''}`}
                            disabled={skillsBusy === skill.id}
                            onClick={() => toggleSkill(skill, !skill.enabled)}
                          >
                            {skill.enabled
                              ? '已启用'
                              : confirmKey === `trust:skill:${skill.id}`
                                ? '确认信任并启用'
                                : '启用'}
                          </button>
                          <button
                            type="button"
                            className="w1-capmini"
                            disabled={detailBusy}
                            onClick={() => toggleSkillDetail(skill)}
                          >
                            {skillDetailId === skill.id ? '收起' : '详情'}
                          </button>
                          {skill.marketplace === 'local' ? null : (
                            <button
                              type="button"
                              className="w1-capmini"
                              disabled={skillsBusy === skill.id}
                              onClick={() => updateSkill(skill)}
                            >
                              更新
                            </button>
                          )}
                          <button
                            type="button"
                            className={`w1-capmini${confirmKey === `skill:${skill.id}` ? ' danger' : ''}`}
                            disabled={skillsBusy === skill.id}
                            onClick={() => removeSkill(skill)}
                          >
                            {confirmKey === `skill:${skill.id}` ? '确认移除' : '移除'}
                          </button>
                        </span>
                      </div>
                      {skillDetailId === skill.id ? (
                        <div className="w1-captoolpanel w1-skilldetail">
                          <div className="w1-captoolh">
                            <span>源文件</span>
                            <button
                              type="button"
                              className="w1-capmini"
                              onClick={() => openSkillFolder(skill)}
                            >
                              打开目录
                            </button>
                          </div>
                          {detailBusy ? (
                            <p className="w1-capnote">正在读取插件目录…</p>
                          ) : skillInspection ? (
                            <>
                              <div className="w1-skillfiles">
                                {skillInspection.files.slice(0, 40).map((file) => (
                                  <span key={file}>{file}</span>
                                ))}
                                {skillInspection.files.length > 40 ? (
                                  <span>+{skillInspection.files.length - 40} 个文件</span>
                                ) : null}
                              </div>
                              {skillInspection.docs.length === 0 ? (
                                <p className="w1-capnote">
                                  没有 SKILL.md；这个插件可能只包含 commands / agents。
                                </p>
                              ) : (
                                skillInspection.docs.map((doc) => (
                                  <div className="w1-skilldoc" key={doc.path}>
                                    <b>{doc.path}</b>
                                    <pre>{doc.content}</pre>
                                  </div>
                                ))
                              )}
                            </>
                          ) : (
                            <p className="w1-capnote">没有可读取的文件。</p>
                          )}
                        </div>
                      ) : null}
                    </Fragment>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="w1-capmarket">
              <div className="w1-capmarketbar">
                <input
                  className="w1-capsearch"
                  value={marketQuery}
                  placeholder="搜索 Claude 市场插件…"
                  aria-label="搜索 Claude 市场插件"
                  onChange={(event) => {
                    setMarketQuery(event.target.value)
                    setMarketLimit(48)
                  }}
                />
                <div className="w1-capseg w1-capsort" role="group" aria-label="市场排序">
                  <button
                    type="button"
                    className={marketSort === 'popular' ? 'on' : ''}
                    aria-pressed={marketSort === 'popular'}
                    onClick={() => setMarketSort('popular')}
                  >
                    热度
                  </button>
                  <button
                    type="button"
                    className={marketSort === 'name' ? 'on' : ''}
                    aria-pressed={marketSort === 'name'}
                    onClick={() => setMarketSort('name')}
                  >
                    名称
                  </button>
                </div>
                <button
                  type="button"
                  className="w1-capmini"
                  disabled={marketBusy}
                  onClick={() => loadMarket(true)}
                >
                  {marketBusy ? '读取中…' : '刷新市场'}
                </button>
              </div>
              {market?.stale ? (
                <p className="w1-capnote">市场缓存较旧：{market.error ?? '刷新失败'}</p>
              ) : null}
              {marketBusy && !market ? (
                <div className="w1-capemptycard">
                  <b>正在读取 Claude 市场…</b>
                  <p>首次会拉取应用私有的官方市场镜像，可能需要 1–2 分钟；不会写全局配置。</p>
                </div>
              ) : filteredMarket.length === 0 ? (
                <div className="w1-capemptycard">
                  <b>{market ? '没有匹配的插件。' : '还没有读取市场。'}</b>
                  <p>市场只作为下载源；安装记录保存在应用自己的目录。</p>
                  {!market ? (
                    <button className="w1-pb pri" type="button" onClick={() => loadMarket(true)}>
                      连接 Claude 市场
                    </button>
                  ) : null}
                </div>
              ) : (
                <>
                  <div className="w1-capgrid">
                    {visibleMarket.map((entry) => (
                      <div className="w1-capcard" key={entry.pluginId}>
                        <span className="w1-capkicker">
                          {marketLabel(entry.marketplace) || 'Claude 官方'} ·{' '}
                          {formatCount(entry.installCount)}
                        </span>
                        <b>{entry.name}</b>
                        <p>{entry.description || 'Claude 插件'}</p>
                        <span className="w1-capactions">
                          {entry.installed ? (
                            <span className="w1-capbadge">已安装</span>
                          ) : (
                            <button
                              type="button"
                              className="w1-capmini pri"
                              disabled={skillsBusy === entry.pluginId}
                              onClick={() => installSkill(entry.pluginId)}
                            >
                              {skillsBusy === entry.pluginId ? '安装中…' : '安装'}
                            </button>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                  {filteredMarket.length > marketLimit ? (
                    <button
                      type="button"
                      className="w1-capmore"
                      onClick={() => setMarketLimit((limit) => limit + 48)}
                    >
                      加载更多 · 还有 {filteredMarket.length - marketLimit} 个
                    </button>
                  ) : null}
                </>
              )}
              <p className="w1-capnote">
                插件只对 Claude 会话生效（通过 --plugin-dir 按会话加载），Codex 不加载 Claude
                插件。用户级 ~/.claude 设置不参与；工作区自带的项目技能仍按项目上下文加载。
              </p>
            </div>
          )}
        </section>
      ) : null}

      {tab === 'mcp' ? (
        <section className="w1-capsection" aria-label="MCP 服务">
          <div className="w1-caphead">
            <span className="w1-capkicker">// EXTERNAL MCP</span>
            <div className="w1-capactions">
              <button
                type="button"
                className="w1-capmini"
                disabled={updatesBusy}
                onClick={checkUpdates}
              >
                {updatesBusy ? '检查中…' : '检查更新'}
              </button>
              <button type="button" className="w1-capmini" onClick={openImport}>
                导入
              </button>
              <button type="button" className="w1-capmini" disabled={jsonBusy} onClick={openExport}>
                导出
              </button>
              <button
                type="button"
                className="w1-capmini pri"
                onClick={() => setForm({ ...EMPTY_FORM })}
              >
                自定义 Server
              </button>
            </div>
          </div>

          <div className="w1-capenv" role="group" aria-label="MCP 环境自检">
            <span className="w1-capenvlabel">// 环境</span>
            {environment.map((item) => (
              <span
                className={`w1-capenvitem${item.available ? '' : ' missing'}`}
                key={item.id}
                title={`${item.command}${item.path ? ` · ${item.path}` : ''}${
                  item.version ? `\n${item.version}` : ''
                }`}
              >
                <b>{item.command}</b>
                {item.available ? envVersion(item.version, item.command) : '缺失'}
              </span>
            ))}
            <button
              type="button"
              className="w1-capmini"
              disabled={envBusy}
              onClick={() => loadEnvironment(true)}
            >
              {envBusy ? '检查中…' : '刷新'}
            </button>
          </div>

          {jsonMode ? (
            <div className="w1-capform">
              <div className="w1-caphead">
                <span className="w1-capkicker">
                  // {jsonMode === 'import' ? '导入 MCP JSON' : '导出 MCP JSON'}
                </span>
                <span className="w1-capnote">
                  {jsonMode === 'import'
                    ? '支持 mcpServers 结构；导入后默认停用、未信任'
                    : 'env / header 只导出 key，密钥值不会导出'}
                </span>
              </div>
              <textarea
                className="w1-capjson"
                rows={8}
                value={jsonText}
                readOnly={jsonMode === 'export'}
                aria-label="MCP JSON 配置"
                onChange={(event) => setJsonText(event.target.value)}
              />
              {jsonMessage ? <p className="w1-capnote">{jsonMessage}</p> : null}
              <div className="w1-capactions">
                <button
                  type="button"
                  className="w1-capmini"
                  disabled={jsonBusy}
                  onClick={() => setJsonMode(null)}
                >
                  取消
                </button>
                {jsonMode === 'import' ? (
                  <button
                    type="button"
                    className="w1-capmini pri"
                    disabled={jsonBusy}
                    onClick={runImport}
                  >
                    {jsonBusy ? '导入中…' : '导入'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="w1-capmini pri"
                    disabled={jsonBusy || !jsonText}
                    onClick={selectJson}
                  >
                    全选
                  </button>
                )}
              </div>
            </div>
          ) : null}

          {form ? (
            <div className="w1-capform">
              <div className="w1-capformgrid">
                <label>
                  <span>名称</span>
                  <input
                    value={form.name}
                    aria-label="MCP 名称"
                    onChange={(event) => setForm({ ...form, name: event.target.value })}
                  />
                </label>
                <label>
                  <span>传输</span>
                  <select
                    value={form.transport}
                    aria-label="MCP 传输方式"
                    onChange={(event) =>
                      setForm({ ...form, transport: event.target.value as 'stdio' | 'http' })
                    }
                  >
                    <option value="stdio">stdio</option>
                    <option value="http">HTTP</option>
                  </select>
                </label>
                <label>
                  <span>用于</span>
                  <select
                    value={form.targets}
                    aria-label="MCP 归属的 Agent"
                    onChange={(event) =>
                      setForm({ ...form, targets: event.target.value as ExternalMcpTargets })
                    }
                  >
                    <option value="both">Claude + Codex</option>
                    <option value="claude">仅 Claude</option>
                    <option value="codex">仅 Codex</option>
                  </select>
                </label>
                {form.transport === 'stdio' ? (
                  <>
                    <label>
                      <span>命令</span>
                      <input
                        value={form.command}
                        placeholder="npx / uvx"
                        aria-label="MCP 命令"
                        onChange={(event) => setForm({ ...form, command: event.target.value })}
                      />
                    </label>
                    <label className="wide">
                      <span>参数（每行一个）</span>
                      <textarea
                        value={form.args}
                        rows={3}
                        aria-label="MCP 参数"
                        onChange={(event) => setForm({ ...form, args: event.target.value })}
                      />
                    </label>
                  </>
                ) : (
                  <label className="wide">
                    <span>URL</span>
                    <input
                      value={form.url}
                      placeholder="https://example.com/mcp"
                      aria-label="MCP URL"
                      onChange={(event) => setForm({ ...form, url: event.target.value })}
                    />
                  </label>
                )}
                <label className="wide">
                  <span>环境变量（KEY=VALUE，每行一个；留空保留旧值）</span>
                  <textarea
                    value={form.env}
                    rows={2}
                    aria-label="MCP 环境变量"
                    onChange={(event) => setForm({ ...form, env: event.target.value })}
                  />
                </label>
                <label className="wide">
                  <span>请求头（KEY=VALUE，每行一个；留空保留旧值）</span>
                  <textarea
                    value={form.headers}
                    rows={2}
                    aria-label="MCP 请求头"
                    onChange={(event) => setForm({ ...form, headers: event.target.value })}
                  />
                </label>
              </div>
              <div className="w1-capactions">
                <button
                  type="button"
                  className="w1-capmini"
                  disabled={mcpBusy === 'form'}
                  onClick={() => setForm(null)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="w1-capmini pri"
                  disabled={mcpBusy === 'form'}
                  onClick={saveForm}
                >
                  {form.id ? '保存修改' : '添加 Server'}
                </button>
              </div>
            </div>
          ) : null}

          {mcp.length === 0 ? (
            <div className="w1-capemptycard">
              <b>还没有外部 MCP Server。</b>
              <p>
                先从内置目录添加，或自定义 stdio / HTTP 服务。新装默认停用，确认命令后才会启用。
              </p>
            </div>
          ) : (
            <>
              <div className="w1-caphead">
                <span className="w1-capkicker">// 已安装 {mcp.length}</span>
                <span className="w1-capnote">启用并信任后可测试连接</span>
              </div>
              <div className="w1-caplist">
                {mcp.map((server) => {
                  const update = updates.find((item) => item.id === server.id)
                  const toolsOpen = Boolean(expandedTools[server.id])
                  return (
                    <Fragment key={server.id}>
                      <div className="w1-caprow">
                        <span className="w1-capglyph">MC</span>
                        <span className="w1-capcopy">
                          <b>
                            {server.name}
                            <i className="w1-capver">{server.transport}</i>
                          </b>
                          <p>{mcpTarget(server) || server.description}</p>
                          <span className="w1-captags">
                            <i>{server.source === 'catalog' ? '内置目录' : '自定义'}</i>
                            {server.targets !== 'both' ? (
                              <i className="w1-captarget">{TARGET_LABELS[server.targets]}</i>
                            ) : null}
                            {server.envKeys.length > 0 ? <i>env {server.envKeys.length}</i> : null}
                            {server.headerKeys.length > 0 ? (
                              <i>header {server.headerKeys.length}</i>
                            ) : null}
                            {server.lastError ? (
                              <i className="warn" title={server.lastError}>
                                {mcpStatus(server)}
                              </i>
                            ) : (
                              <i>{mcpStatus(server)}</i>
                            )}
                            {update?.hasUpdate ? (
                              <i className="warn">可更新 {update.latestVersion}</i>
                            ) : null}
                            {server.toolNames.slice(0, 5).map((tool) => (
                              <i key={tool}>{tool}</i>
                            ))}
                            {server.toolNames.length > 5 ? (
                              <i>+{server.toolNames.length - 5}</i>
                            ) : null}
                          </span>
                        </span>
                        <span className="w1-capactions">
                          <button
                            type="button"
                            className={`w1-setbtn${server.enabled ? ' on' : ''}`}
                            disabled={mcpBusy === server.id}
                            onClick={() => toggleMcp(server, !server.enabled)}
                          >
                            {server.enabled
                              ? '已启用'
                              : confirmKey === `trust:mcp:${server.id}`
                                ? '确认信任并启用'
                                : '启用'}
                          </button>
                          {server.tools.length > 0 ? (
                            <button
                              type="button"
                              className="w1-capmini"
                              disabled={mcpBusy === server.id}
                              onClick={() => toggleTools(server)}
                            >
                              {toolsOpen ? '收起工具' : `工具 ${server.tools.length}`}
                            </button>
                          ) : null}
                          {server.trusted ? (
                            <button
                              type="button"
                              className="w1-capmini"
                              disabled={mcpBusy === server.id}
                              onClick={() => testMcp(server)}
                            >
                              {server.lastTestAt ? '重测' : '测试'}
                            </button>
                          ) : null}
                          {update?.hasUpdate ? (
                            <button
                              type="button"
                              className="w1-capmini"
                              disabled={mcpBusy === server.id}
                              onClick={() => applyUpdate(server)}
                            >
                              更新
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="w1-capmini"
                            disabled={mcpBusy === server.id}
                            onClick={() => setForm(formFromServer(server))}
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            className={`w1-capmini${confirmKey === `mcp:${server.id}` ? ' danger' : ''}`}
                            disabled={mcpBusy === server.id}
                            onClick={() => removeMcp(server)}
                          >
                            {confirmKey === `mcp:${server.id}` ? '确认移除' : '移除'}
                          </button>
                        </span>
                      </div>
                      {toolsOpen ? (
                        <div className="w1-captoolpanel">
                          <div className="w1-captoolh">
                            <span>工具级权限</span>
                            <span>自动批准只建议用于只读工具；下一次会话生效</span>
                          </div>
                          {server.tools.map((tool) => (
                            <div className="w1-captool" key={tool.name}>
                              <span className="w1-captoolname">
                                <b>{tool.name}</b>
                                <i className={tool.readOnly ? 'ro' : 'rw'}>
                                  {tool.readOnly ? '只读' : '可写'}
                                </i>
                              </span>
                              <span className="w1-captooldesc" title={tool.description}>
                                {tool.description || '—'}
                              </span>
                              <span
                                className="w1-captoolseg"
                                role="group"
                                aria-label={`${tool.name} 权限`}
                              >
                                {(
                                  [
                                    ['allow', '自动'],
                                    ['ask', '询问'],
                                    ['deny', '禁止']
                                  ] as const
                                ).map(([value, label]) => (
                                  <button
                                    key={value}
                                    type="button"
                                    className={tool.approval === value ? `on ${value}` : ''}
                                    aria-pressed={tool.approval === value}
                                    disabled={mcpBusy === server.id}
                                    title={
                                      value === 'allow' && !tool.readOnly
                                        ? '可写工具自动批准有副作用风险'
                                        : undefined
                                    }
                                    onClick={() => changeToolPolicy(server, tool.name, value)}
                                  >
                                    {label}
                                  </button>
                                ))}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </Fragment>
                  )
                })}
              </div>
            </>
          )}

          <div className="w1-caphead">
            <span className="w1-capkicker">// 内置目录</span>
            <span className="w1-capnote">安装后仍需启用并确认信任</span>
          </div>
          <div className="w1-capgrid">
            {catalog.map((entry) => (
              <div className="w1-capcard" key={entry.id}>
                <span className="w1-capkicker">{entry.transport}</span>
                <b>{entry.name}</b>
                <p>{entry.description}</p>
                <span className="w1-capactions">
                  {installedCatalog.has(entry.id) ? (
                    <span className="w1-capbadge">已添加</span>
                  ) : (
                    <button
                      type="button"
                      className="w1-capmini pri"
                      disabled={mcpBusy === entry.id}
                      onClick={() => addCatalogServer(entry)}
                    >
                      {mcpBusy === entry.id ? '添加中…' : '添加'}
                    </button>
                  )}
                </span>
              </div>
            ))}
          </div>
          <p className="w1-capnote">
            外部 MCP 会进入本应用启动的 Claude 会话，以及激活 Provider 后的 Codex app-server
            会话；密钥只进子进程环境，继承 CLI 的 Codex exec 与全局 MCP 不受影响。
          </p>
        </section>
      ) : null}

      {tab === 'tools' ? (
        <section className="w1-capsection" aria-label="工具总览">
          <div className="w1-caphead">
            <span className="w1-capkicker">// TOOL OVERVIEW</span>
            <span className="w1-capnote">
              内置 {tools.filter((tool) => tool.enabled).length}/{tools.length} 启用
            </span>
          </div>
          {(Object.keys(DOMAIN_LABELS) as (keyof typeof DOMAIN_LABELS)[]).map((domain) => {
            const list = tools.filter((tool) => tool.domain === domain)
            if (list.length === 0) return null
            return (
              <div className="w1-capdomain" key={domain}>
                <h4>{DOMAIN_LABELS[domain]}</h4>
                <div className="w1-caplist">
                  {list.map((tool) => (
                    <div
                      className={`w1-caprow static builtin with-toggle${tool.enabled ? '' : ' off'}`}
                      key={tool.name}
                    >
                      <span className={`w1-capglyph${tool.write ? ' write' : ''}`}>
                        {tool.write ? 'W' : 'R'}
                      </span>
                      <span className="w1-capcopy">
                        <b>{tool.name}</b>
                        <p>{tool.description}</p>
                      </span>
                      <span className={`w1-capbadge${tool.write ? ' write' : ''}`}>
                        {tool.write ? '写入' : '只读'}
                      </span>
                      <button
                        type="button"
                        className={`w1-setbtn${tool.enabled ? ' on' : ''}`}
                        disabled={builtinBusy === tool.name}
                        aria-pressed={tool.enabled}
                        aria-label={`${tool.name} ${tool.enabled ? '已启用，点击关闭' : '已关闭，点击启用'}`}
                        onClick={() => toggleBuiltin(tool)}
                      >
                        {builtinBusy === tool.name ? '…' : tool.enabled ? '已启用' : '已关闭'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
          <div className="w1-capdomain">
            <h4>外部 MCP</h4>
            <div className="w1-caplist">
              {mcp.length === 0 ? (
                <p className="w1-capnote">还没有外部 Server，在「外部 MCP」里添加。</p>
              ) : (
                mcp.map((server) => (
                  <div className="w1-caprow static" key={server.id}>
                    <span className="w1-capglyph">MC</span>
                    <span className="w1-capcopy">
                      <b>
                        {server.name}
                        <i className="w1-capver">{server.transport}</i>
                      </b>
                      <p>{mcpTarget(server) || server.description}</p>
                    </span>
                    <span className="w1-capbadge">{mcpStatus(server)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="w1-capdomain">
            <h4>CLI 原生工具</h4>
            <div className="w1-caplist">
              {NATIVE_TOOLS.map((tool) => (
                <div className="w1-caprow static" key={tool.name}>
                  <span className="w1-capglyph">CL</span>
                  <span className="w1-capcopy">
                    <b>{tool.name}</b>
                    <p>{tool.description}</p>
                  </span>
                  <span className="w1-capbadge">{tool.kind}</span>
                </div>
              ))}
            </div>
          </div>
          <p className="w1-capnote">
            内置工具关闭后桥不再列出也不执行它；写入工具仍受「MCP 域权限」拦截。CLI 原生工具由
            Claude / Codex 自己提供，不能在这里关闭，只能经审批卡与审批规则约束。
          </p>
        </section>
      ) : null}
    </div>
  )
}
