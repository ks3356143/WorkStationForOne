import { useEffect, useMemo, useState } from 'react'
import type {
  AgentKind,
  InstalledPluginRecord,
  SkillRecord,
  ToolSurfaceBundle,
  UpdateCandidateRecord
} from '../../../../shared/ipc'
import { friendlyMessage } from '../../lib/errors'
import { fallbackCopy } from '../../lib/clipboard'
import { replaceById } from '../../lib/collections'
import { buildToolPriorityPrompt } from '../../../../shared/tool-surface'
import { PluginsTab } from './PluginsTab'
import { SkillsTab } from './SkillsTab'
import { McpTab } from './McpTab'
import { NativeToolsTab } from './NativeToolsTab'
import { RecommendationsTab } from './RecommendationsTab'

interface CapabilityPanelProps {
  notify: (text: string) => void
}

type PanelTab = 'plugins' | 'skills' | 'mcp' | 'native' | 'recommend'

const TABS: Array<[PanelTab, string]> = [
  ['plugins', '插件'],
  ['skills', '技能'],
  ['mcp', 'MCP'],
  ['native', '内置工具'],
  ['recommend', '推荐']
]

/**
 * 能力中心：只管 Claude Code / Codex 的编码能力。
 * 插件 = 包生命周期；技能 = 启用与首选；MCP = 外部 Server 与首选；内置工具 = CLI 原生开关与环境。
 * 应用数据桥（任务 / 笔记 / 学习 / 习惯）在基础设置的「数据桥」分区。
 */
export function CapabilityPanel({ notify }: CapabilityPanelProps) {
  const api = typeof window === 'undefined' ? undefined : window.ws?.capability
  const [tab, setTab] = useState<PanelTab>('plugins')
  const [skills, setSkills] = useState<SkillRecord[]>([])
  const [installedCodex, setInstalledCodex] = useState<InstalledPluginRecord[]>([])
  const [surface, setSurface] = useState<ToolSurfaceBundle | null>(null)
  const [surfaceAgent, setSurfaceAgent] = useState<AgentKind>('claude')
  const [surfaceBusy, setSurfaceBusy] = useState<string | null>(null)
  const [pendingUpdates, setPendingUpdates] = useState<UpdateCandidateRecord[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [updateBusy, setUpdateBusy] = useState(false)
  const [checkBusy, setCheckBusy] = useState(false)
  const [updateReport, setUpdateReport] = useState('')
  const [marketToken, setMarketToken] = useState(0)

  const refreshSurface = () => {
    if (!api) return
    void api
      .toolSurface()
      .then(setSurface)
      .catch(() => {})
  }

  const refreshPluginLists = () => {
    if (!api) return
    void Promise.all([api.skills.list(), api.installedPlugins()])
      .then(([nextSkills, nextInstalled]) => {
        setSkills(nextSkills)
        setInstalledCodex(nextInstalled.filter((item) => item.agent === 'codex'))
      })
      .catch(() => {})
  }

  const refreshLists = () => {
    if (!api) return
    refreshPluginLists()
    refreshSurface()
  }

  /** 首屏三个列表一起读；失败时保留错误，供横幅里的「重试」再调一次。 */
  const loadCore = () => {
    if (!api) return
    setLoading(true)
    setError(null)
    void Promise.all([api.skills.list(), api.installedPlugins(), api.toolSurface()])
      .then(([nextSkills, nextInstalled, nextSurface]) => {
        setSkills(nextSkills)
        setInstalledCodex(nextInstalled.filter((item) => item.agent === 'codex'))
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
    void Promise.all([api.skills.list(), api.installedPlugins(), api.toolSurface()])
      .then(([nextSkills, nextInstalled, nextSurface]) => {
        if (!alive) return
        setSkills(nextSkills)
        setInstalledCodex(nextInstalled.filter((item) => item.agent === 'codex'))
        setSurface(nextSurface)
      })
      .catch((reason: unknown) => {
        if (alive) setError(friendlyMessage(reason, '能力中心读取失败'))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    const offUpdates = api.onUpdateAvailable?.((list) => {
      if (alive) setPendingUpdates(list)
    })
    return () => {
      alive = false
      offUpdates?.()
    }
  }, [api])

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
          preferred: server.preferred,
          note: server.note
        })),
      skills: current.skills
        .filter((skill) => skill.enabled)
        .map((skill) => ({ name: skill.name, preferred: skill.preferred, note: skill.note }))
    })
  }, [surface, surfaceAgent])

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
    if (!api?.moveTool || surfaceBusy || !surface) return
    const current = surface[surfaceAgent]
    const list = [...current.mcp, ...current.skills]
    const index = list.findIndex((item) => item.id === key)
    const from = list[index]
    const to = list[direction === 'up' ? index - 1 : index + 1]
    if (!from || !to) return
    // 首选分组固定置顶：跨组换位写进去也会被排序抹平，点击时直接说明原因。
    if (from.preferred !== to.preferred) {
      notify('首选分组固定置顶；先取消 ★ 再和其它项换位')
      return
    }
    setSurfaceBusy(`move:${key}`)
    void api
      .moveTool(surfaceAgent, key, direction)
      .then(setSurface)
      .catch((reason: unknown) => notify(friendlyMessage(reason, '工具排序失败')))
      .finally(() => setSurfaceBusy(null))
  }

  const togglePreferred = (key: string, preferred: boolean) => {
    if (!api?.setPreferredTool || surfaceBusy || !surface) return
    const current = surface[surfaceAgent]
    const item = [...current.mcp, ...current.skills].find((entry) => entry.id === key)
    if (!item) return
    // 未启用 / 未信任的项进不了会话，设成首选没有意义；给可见反馈而不是静默 return。
    // 取消首选始终允许，避免停用后再也摘不掉 ★。
    if (!item.enabled && preferred) {
      notify(
        key.startsWith('skill:')
          ? '先启用并信任这个技能才能设为首选'
          : '先启用并信任这个 Server 才能设为首选'
      )
      return
    }
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

  const saveToolNote = (key: string, note: string) => {
    if (!api?.setToolNote || surfaceBusy || !surface) return
    setSurfaceBusy(`note:${key}`)
    void api
      .setToolNote(surfaceAgent, key, note)
      .then((next) => {
        setSurface(next)
        notify(note.trim() ? '用途说明已保存 · 下一次会话生效' : '用途说明已清空')
      })
      .catch((reason: unknown) => notify(friendlyMessage(reason, '用途说明保存失败')))
      .finally(() => setSurfaceBusy(null))
  }

  /** 技能启用单一入口：Claude 走信任流程，Codex 写私有 config.toml 并同步 skill 副本。 */
  const toggleSkillRuntime = (skill: SkillRecord, enable: boolean, trust: boolean) => {
    if (!api || surfaceBusy) return
    setSurfaceBusy(`skill:${skill.id}`)
    const request =
      skill.agent === 'codex'
        ? api.setPluginEnabled({ id: skill.id, agent: 'codex', enabled: enable }).then(() => {
            // 列表单独刷新；工具面由下面的链路统一取一次，避免重复请求
            refreshPluginLists()
          })
        : api.skills.setEnabled(skill.id, enable, enable && trust).then((updated) => {
            setSkills((list) => replaceById(list, updated))
          })
    void request
      .then(() => api.toolSurface())
      .then((next) => {
        setSurface(next)
        notify(`${skill.name} 已${enable ? '启用' : '停用'} · 下一次会话生效`)
      })
      .catch((reason: unknown) => notify(friendlyMessage(reason, '插件状态更新失败')))
      .finally(() => setSurfaceBusy(null))
  }

  /** 手动检查：额外带上本机 CLI 版本；不自动更新，CLI 只给复制命令。 */
  const checkNow = () => {
    if (!api?.checkUpdates || checkBusy) return
    setCheckBusy(true)
    setUpdateReport('')
    void api
      .checkUpdates()
      .then((list) => {
        setPendingUpdates(list)
        if (list.length === 0) setUpdateReport('已是最新')
      })
      .catch((reason: unknown) => notify(friendlyMessage(reason, '检查更新失败')))
      .finally(() => setCheckBusy(false))
  }

  /** 全部更新：插件 / MCP 直接更新；本机 CLI 只提供复制命令。 */
  const applyAllUpdates = () => {
    if (!api?.applyUpdates || updateBusy || pendingUpdates.length === 0) return
    const batch = pendingUpdates.filter((item) => item.kind !== 'cli')
    if (batch.length === 0) {
      notify('本机 CLI 需要复制更新命令后自行执行')
      return
    }
    setUpdateBusy(true)
    setUpdateReport('')
    void api
      .applyUpdates(batch)
      .then((outcome) => {
        const doneIds = new Set(outcome.updated.map((item) => item.id))
        setPendingUpdates((list) => list.filter((item) => !doneIds.has(item.id)))
        refreshLists()
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

  const currentSurface = surface ? surface[surfaceAgent] : null
  const cliCandidates = pendingUpdates.filter((item) => item.kind === 'cli')
  const pluginCount = pendingUpdates.filter((item) => item.kind === 'plugin').length
  const mcpCount = pendingUpdates.filter((item) => item.kind === 'mcp').length
  const updateSummary = [
    pluginCount > 0 ? `${pluginCount} 个插件` : '',
    mcpCount > 0 ? `${mcpCount} 个 MCP` : '',
    cliCandidates.length > 0 ? `${cliCandidates.length} 个本机 CLI` : ''
  ]
    .filter(Boolean)
    .join('、')

  return (
    <div className="w1-cap">
      {pendingUpdates.length > 0 || updateReport ? (
        <>
          <div className="w1-capupdate" role="status">
            <span>
              {updateBusy
                ? '正在更新…'
                : pendingUpdates.length > 0
                  ? `${updateSummary}可更新`
                  : updateReport || '更新完成'}
              {pendingUpdates.length > 0 && updateReport ? (
                <em className="w1-capupdatenote">{updateReport}</em>
              ) : null}
            </span>
            <span className="w1-capupdateacts">
              {pendingUpdates.length > 0 && pluginCount + mcpCount > 0 ? (
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
                    setTab(
                      pendingUpdates.some((item) => item.kind === 'plugin')
                        ? 'plugins'
                        : pendingUpdates.some((item) => item.kind === 'mcp')
                          ? 'mcp'
                          : 'native'
                    )
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
          {cliCandidates.length > 0 ? (
            <div className="w1-capupdatecli">
              {cliCandidates.map((item) => (
                <span key={item.id} className="w1-capupdateclirow">
                  <b>{item.name}</b>
                  <span>
                    {item.current} → {item.latest}
                  </span>
                  <button
                    type="button"
                    className="w1-capmini"
                    onClick={() => {
                      const command = item.command ?? ''
                      if (!command) return
                      const done = () => notify(`已复制：${command}`)
                      if (navigator.clipboard?.writeText) {
                        navigator.clipboard
                          .writeText(command)
                          .then(done, () => fallbackCopy(command, done))
                      } else {
                        fallbackCopy(command, done)
                      }
                    }}
                  >
                    复制更新命令
                  </button>
                </span>
              ))}
              <em className="w1-capupdatenote">
                本机 CLI 请复制命令自行更新；更新后新工具才会进入 agent
              </em>
            </div>
          ) : null}
        </>
      ) : null}
      <div className="w1-capnav" role="tablist" aria-label="能力中心">
        {TABS.map(([value, label]) => (
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
        <button type="button" className="w1-capmini" disabled={checkBusy} onClick={checkNow}>
          {checkBusy ? '检查中…' : '检查更新'}
        </button>
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

      {tab === 'plugins' ? (
        <PluginsTab
          notify={notify}
          loading={loading}
          skills={skills}
          installedCodex={installedCodex}
          onSkillsChanged={refreshLists}
          onOpenSkills={() => setTab('skills')}
          marketToken={marketToken}
        />
      ) : null}

      {tab === 'skills' ? (
        <SkillsTab
          agent={surfaceAgent}
          skills={skills}
          surface={currentSurface}
          busy={surfaceBusy}
          notify={notify}
          onAgent={setSurfaceAgent}
          onToggle={toggleSkillRuntime}
          onPreferred={togglePreferred}
          onNote={saveToolNote}
          onMove={moveTool}
        />
      ) : null}

      {tab === 'mcp' ? (
        <McpTab
          notify={notify}
          agent={surfaceAgent}
          surfaceMcp={currentSurface?.mcp ?? []}
          priorityBusy={surfaceBusy}
          onAgent={setSurfaceAgent}
          onPreferred={togglePreferred}
          onNote={saveToolNote}
          onMove={moveTool}
          onSurfaceDirty={refreshSurface}
        />
      ) : null}

      {tab === 'native' ? (
        <NativeToolsTab
          agent={surfaceAgent}
          surface={currentSurface}
          busy={surfaceBusy}
          notify={notify}
          onAgent={setSurfaceAgent}
          onToggleNative={toggleNativeTool}
          promptPreview={promptPreview}
        />
      ) : null}

      {tab === 'recommend' ? (
        <RecommendationsTab
          notify={notify}
          onOpenMarket={() => {
            setTab('plugins')
            setMarketToken((token) => token + 1)
          }}
        />
      ) : null}
    </div>
  )
}
