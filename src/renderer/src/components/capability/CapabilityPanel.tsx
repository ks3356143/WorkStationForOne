import { Fragment, useEffect, useMemo, useState } from 'react'
import type {
  AgentKind,
  BuiltinToolRecord,
  ExternalMcpServerRecord,
  InstalledPluginRecord,
  LocalScanRecord,
  PluginSourceRecord,
  ToolSurfaceBundle,
  UpdateCandidateRecord,
  SkillInspection,
  SkillMarketSnapshot,
  SkillRecord
} from '../../../../shared/ipc'
import { friendlyMessage } from '../../lib/errors'
import { replaceById } from '../../lib/collections'
import { buildToolPriorityPrompt } from '../../../../shared/tool-surface'
import { StatePlaceholder } from '../StatePlaceholder'
import { ToolsTab } from './ToolsTab'
import { McpTab } from './McpTab'
import { filterMarket, formatCount, marketLabel, sortMarket } from '../../lib/capabilities'

interface CapabilityPanelProps {
  notify: (text: string) => void
}

type PanelTab = 'skills' | 'mcp' | 'tools'
type SkillTab = 'installed' | 'market'

const COMPONENT_LABELS: Record<string, string> = {
  skills: '技能',
  commands: '命令',
  agents: '子代理',
  hooks: 'hooks',
  mcp: 'MCP'
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
  const [builtinBusy, setBuiltinBusy] = useState<string | null>(null)
  const [surface, setSurface] = useState<ToolSurfaceBundle | null>(null)
  const [surfaceAgent, setSurfaceAgent] = useState<AgentKind>('claude')
  const [surfaceBusy, setSurfaceBusy] = useState<string | null>(null)
  const [toolConfirmKey, setToolConfirmKey] = useState('')
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
  const [confirmKey, setConfirmKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [updateReport, setUpdateReport] = useState('')

  /** 首屏三个列表一起读；失败时保留错误，供横幅里的「重试」再调一次。 */
  const loadCore = () => {
    if (!api) return
    setLoading(true)
    setError(null)
    void Promise.all([api.skills.list(), api.mcp.list(), api.toolSurface()])
      .then(([nextSkills, nextMcp, nextSurface]) => {
        setSkills(nextSkills)
        setMcp(nextMcp)
        setSurface(nextSurface)
      })
      .catch((reason: unknown) => setError(friendlyMessage(reason, '能力中心读取失败')))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!api) {
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    void Promise.all([api.skills.list(), api.mcp.list(), api.toolSurface()])
      .then(([nextSkills, nextMcp, nextSurface]) => {
        if (!alive) return
        setSkills(nextSkills)
        setMcp(nextMcp)
        setSurface(nextSurface)
      })
      .catch((reason: unknown) => {
        if (alive) setError(friendlyMessage(reason, '能力中心读取失败'))
      })
      .finally(() => {
        if (alive) setLoading(false)
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

  const filteredMarket = useMemo(
    () => sortMarket(filterMarket(market?.entries ?? [], marketQuery), marketSort),
    [market, marketQuery, marketSort]
  )
  const visibleMarket = filteredMarket.slice(0, marketLimit)

  /** 预览与实际注入走同一个纯函数，避免界面承诺和会话里收到的文本不一致。 */
  const promptPreview = useMemo(() => {
    if (!surface) return ''
    const current = surface[surfaceAgent]
    return buildToolPriorityPrompt(surfaceAgent, {
      mcp: current.mcp
        .filter((server) => server.enabled)
        .map((server) => ({
          name: server.name,
          tools: server.tools,
          preferred: server.preferred
        })),
      skills: current.skills
        .filter((skill) => skill.enabled)
        .map((skill) => ({ name: skill.name, preferred: skill.preferred }))
    })
  }, [surface, surfaceAgent])

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
      .catch((reason: unknown) => setError(friendlyMessage(reason, 'Claude 市场读取失败')))
      .finally(() => setMarketBusy(false))
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
        setSkills((list) => replaceById(list, updated))
        notify(enable ? `已启用 ${updated.name}` : `已停用 ${updated.name}`)
      })
      .catch((reason: unknown) => notify(friendlyMessage(reason, '插件状态更新失败')))
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
      .catch((reason: unknown) => notify(friendlyMessage(reason, '插件安装失败')))
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
      .catch((reason: unknown) => notify(friendlyMessage(reason, '本地导入失败')))
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
        notify(friendlyMessage(reason, '读取技能文件失败'))
      })
      .finally(() => setDetailBusy(false))
  }

  const openSkillFolder = (skill: SkillRecord) => {
    if (!api) return
    void api.skills
      .openFolder(skill.id)
      .catch((reason: unknown) => notify(friendlyMessage(reason, '打开目录失败')))
  }

  const updateSkill = (skill: SkillRecord) => {
    if (!api || skillsBusy) return
    setSkillsBusy(skill.id)
    void api.skills
      .update(skill.id)
      .then((updated) => {
        setSkills((list) => replaceById(list, updated))
        notify(`${updated.name} 已更新到 ${updated.version || '最新版本'}`)
      })
      .catch((reason: unknown) => notify(friendlyMessage(reason, '插件更新失败')))
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
      .catch((reason: unknown) => notify(friendlyMessage(reason, '插件移除失败')))
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
      .catch((reason: unknown) => notify(friendlyMessage(reason, '插件启停失败')))
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
      .catch((reason: unknown) => notify(friendlyMessage(reason, '卸载失败')))
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
      .catch((reason: unknown) => notify(friendlyMessage(reason, '添加源失败')))
      .finally(() => setSourceBusy(null))
  }

  const refreshSource = (source: PluginSourceRecord) => {
    if (!api || sourceBusy) return
    setSourceBusy(source.id)
    void api
      .refreshPluginSource(source.id)
      .then((saved) => {
        setSources((list) => replaceById(list, saved))
        notify(`${saved.name} 已刷新 · ${saved.pluginCount} 个插件`)
      })
      .catch((reason: unknown) => notify(friendlyMessage(reason, '刷新源失败')))
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
      .catch((reason: unknown) => notify(friendlyMessage(reason, '移除源失败')))
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
      .catch((reason: unknown) => notify(friendlyMessage(reason, '本机扫描失败')))
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
      .catch((reason: unknown) => notify(friendlyMessage(reason, '导入失败')))
      .finally(() => setScanBusy(false))
  }

  const toggleBuiltin = (tool: BuiltinToolRecord) => {
    if (!api?.setBuiltinTool || builtinBusy) return
    setBuiltinBusy(tool.name)
    void api
      .setBuiltinTool(tool.name, !tool.enabled)
      .then((next) => {
        setSurface((current) =>
          current
            ? {
                claude: { ...current.claude, builtin: next },
                codex: { ...current.codex, builtin: next }
              }
            : current
        )
        notify(`${tool.name} 已${tool.enabled ? '关闭' : '启用'} · 下一次会话生效`)
      })
      .catch((reason: unknown) => notify(friendlyMessage(reason, '内置工具开关失败')))
      .finally(() => setBuiltinBusy(null))
  }

  const toggleNativeTool = (id: string, enabled: boolean) => {
    if (!api?.setNativeTool || surfaceBusy) return
    setSurfaceBusy(`native:${id}`)
    void api
      .setNativeTool(surfaceAgent, id, enabled)
      .then((next) => {
        setSurface(next)
        notify(`原生工具已${enabled ? '启用' : '关闭'} · 下一次会话生效`)
      })
      .catch((reason: unknown) => notify(friendlyMessage(reason, '原生工具开关失败')))
      .finally(() => setSurfaceBusy(null))
  }

  const moveTool = (key: string, direction: 'up' | 'down') => {
    if (!api?.moveTool || surfaceBusy) return
    setSurfaceBusy(`move:${key}`)
    void api
      .moveTool(surfaceAgent, key, direction)
      .then(setSurface)
      .catch((reason: unknown) => notify(friendlyMessage(reason, '工具排序失败')))
      .finally(() => setSurfaceBusy(null))
  }

  const togglePreferred = (key: string, preferred: boolean) => {
    if (!api?.setPreferredTool || surfaceBusy) return
    setSurfaceBusy(`prefer:${key}`)
    void api
      .setPreferredTool(surfaceAgent, key, preferred)
      .then((next) => {
        setSurface(next)
        notify(preferred ? '已设为首选 · 下一次会话优先调用它' : '已取消首选 · 下一次会话生效')
      })
      .catch((reason: unknown) => notify(friendlyMessage(reason, '首选设置失败')))
      .finally(() => setSurfaceBusy(null))
  }

  /** 工具面里的 MCP / 技能开关复用同一个信任流程，成功后刷新两侧状态。 */
  const toggleSurfaceMcp = (server: ExternalMcpServerRecord, enable: boolean) => {
    if (!api || surfaceBusy) return
    const risky = enable && !server.trusted
    if (risky && toolConfirmKey !== `trust:mcp:${server.id}`) {
      setToolConfirmKey(`trust:mcp:${server.id}`)
      notify(`再次点击确认信任 ${server.name} 的命令与参数`)
      return
    }
    setToolConfirmKey('')
    setSurfaceBusy(`mcp:${server.id}`)
    void api.mcp
      .setEnabled(server.id, enable, risky)
      .then((updated) => {
        setMcp((list) => replaceById(list, updated))
        notify(`${updated.name} 已${enable ? '启用' : '停用'} · 下一次会话生效`)
        return api.toolSurface()
      })
      .then(setSurface)
      .catch((reason: unknown) => notify(friendlyMessage(reason, 'MCP 状态更新失败')))
      .finally(() => setSurfaceBusy(null))
  }

  const toggleSurfaceSkill = (skill: SkillRecord, enable: boolean) => {
    if (!api || surfaceBusy) return
    const risky = enable && (skill.hasHooks || skill.hasMcp) && !skill.trusted
    if (risky && toolConfirmKey !== `trust:skill:${skill.id}`) {
      setToolConfirmKey(`trust:skill:${skill.id}`)
      notify(`再次点击确认信任 ${skill.name} 的 hooks / MCP 组件`)
      return
    }
    setToolConfirmKey('')
    setSurfaceBusy(`skill:${skill.id}`)
    void api.skills
      .setEnabled(skill.id, enable, risky)
      .then((updated) => {
        setSkills((list) => replaceById(list, updated))
        notify(`${updated.name} 已${enable ? '启用' : '停用'} · 下一次会话生效`)
        return api.toolSurface()
      })
      .then(setSurface)
      .catch((reason: unknown) => notify(friendlyMessage(reason, '插件状态更新失败')))
      .finally(() => setSurfaceBusy(null))
  }

  /** 全部更新：成功后从候选里剔除，失败的留在横幅里并显示原因。 */
  const applyAllUpdates = () => {
    if (!api?.applyUpdates || updateBusy || pendingUpdates.length === 0) return
    const batch = pendingUpdates
    setUpdateBusy(true)
    setUpdateReport('')
    void api
      .applyUpdates(batch)
      .then(async (outcome) => {
        const doneIds = new Set(outcome.updated.map((item) => item.id))
        setPendingUpdates((list) => list.filter((item) => !doneIds.has(item.id)))
        // 刷新两侧列表，让版本号与启用状态跟数据库一致
        const [nextSkills, nextCodex] = await Promise.all([
          api.skills.list(),
          api.installedPlugins()
        ])
        setSkills(nextSkills)
        setInstalledCodex(nextCodex.filter((item) => item.agent === 'codex'))
        if (outcome.failed.length === 0) {
          setUpdateReport(`已更新 ${outcome.updated.length} 个`)
          notify(`已更新 ${outcome.updated.length} 个`)
          return
        }
        const first = outcome.failed[0]
        setUpdateReport(
          `${outcome.updated.length} 个已更新 · ${outcome.failed.length} 个失败：${first.name} ${first.reason}`
        )
        notify(`${outcome.failed.length} 个更新失败：${first.name} — ${first.reason}`)
      })
      .catch((reason: unknown) => notify(friendlyMessage(reason, '应用更新失败')))
      .finally(() => setUpdateBusy(false))
  }

  if (!api) {
    return (
      <div className="w1-capempty">当前环境没有 preload 桥，能力中心不可用。请从桌面应用打开。</div>
    )
  }

  return (
    <div className="w1-cap">
      {pendingUpdates.length > 0 || updateReport ? (
        <div className="w1-capupdate" role="status">
          <span>
            {updateBusy
              ? '正在更新…'
              : pendingUpdates.length > 0
                ? `${pendingUpdates.filter((item) => item.kind === 'plugin').length} 个插件、${
                    pendingUpdates.filter((item) => item.kind === 'mcp').length
                  } 个 MCP 可更新`
                : '更新完成'}
            {updateReport ? <em className="w1-capupdatenote">{updateReport}</em> : null}
          </span>
          <span className="w1-capupdateacts">
            {pendingUpdates.length > 0 ? (
              <button
                type="button"
                className="w1-capmini pri"
                disabled={updateBusy}
                onClick={applyAllUpdates}
              >
                {updateBusy ? '更新中…' : '全部更新'}
              </button>
            ) : null}
            <button
              type="button"
              className="w1-capmini"
              disabled={updateBusy}
              onClick={() => {
                if (pendingUpdates.length > 0) {
                  setTab(pendingUpdates.some((item) => item.kind === 'plugin') ? 'skills' : 'mcp')
                }
                setPendingUpdates([])
                setUpdateReport('')
              }}
            >
              {pendingUpdates.length > 0 ? '查看' : '知道了'}
            </button>
            {pendingUpdates.length > 0 ? (
              <button
                type="button"
                className="w1-capmini"
                disabled={updateBusy}
                onClick={() => setPendingUpdates([])}
              >
                稍后
              </button>
            ) : null}
          </span>
        </div>
      ) : null}
      <div className="w1-capnav" role="tablist" aria-label="能力中心">
        {(
          [
            ['skills', '技能 / 插件'],
            ['mcp', 'MCP 服务'],
            ['tools', '工具面']
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
          <button type="button" className="w1-capmini pri" onClick={loadCore}>
            重试
          </button>
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
              {loading && skills.length === 0 ? (
                <StatePlaceholder kind="loading" rows={3} />
              ) : skills.length === 0 && installedCodex.length === 0 ? (
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
                这个市场供 Claude 会话加载（通过 --plugin-dir 按会话生效）。Codex
                插件从同一份市场安装，装完后同步一份 skill 到应用私有的 codex-home。用户级 ~/.claude
                设置不参与；工作区自带的项目技能仍按项目上下文加载。
              </p>
            </div>
          )}
        </section>
      ) : null}

      {tab === 'mcp' ? <McpTab notify={notify} /> : null}

      {tab === 'tools' ? (
        <ToolsTab
          agent={surfaceAgent}
          surface={surface ? surface[surfaceAgent] : null}
          mcp={mcp}
          skills={skills}
          busy={surfaceBusy ?? (builtinBusy ? `builtin:${builtinBusy}` : null)}
          onAgent={setSurfaceAgent}
          onToggleNative={toggleNativeTool}
          onMove={moveTool}
          onToggleMcp={toggleSurfaceMcp}
          onToggleSkill={toggleSurfaceSkill}
          onToggleBuiltin={toggleBuiltin}
          onPreferred={togglePreferred}
          promptPreview={promptPreview}
          onOpenMcp={() => setTab('mcp')}
        />
      ) : null}
    </div>
  )
}
