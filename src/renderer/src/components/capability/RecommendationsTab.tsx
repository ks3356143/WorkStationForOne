import { useCallback, useEffect, useMemo, useState } from 'react'
import { fallbackCopy } from '../../lib/clipboard'
import {
  CLI_CATEGORY_LABELS,
  CLI_RECOMMEND_CATEGORIES,
  RECOMMENDED_CLI_TOOLS,
  type CliRecommendCategory,
  type CliRecommendation,
  MCP_RECOMMENDATIONS,
  SKILL_SOURCE_RECOMMENDATIONS,
  type McpRecommendation,
  type SkillSourceRecommendation
} from '../../../../shared/recommendations'
import type {
  CliRuntimeState,
  CliRuntimeUpdate,
  ExternalMcpServerRecord,
  PluginSourceRecord
} from '../../../../shared/ipc'
import { defaultSource, type CliSource } from '../../../../shared/runtime-source'
import { StatePlaceholder } from '../StatePlaceholder'

interface RecommendationsTabProps {
  notify: (text: string) => void
  onOpenMarket: () => void
}

/** 环境依赖行：系统 / 托管二选一，托管可装可卸，新版只提示不自动更新。 */
function RuntimeRow({
  tool,
  state,
  update,
  busy,
  confirming,
  onSource,
  onInstall,
  onUninstall,
  onCopy
}: {
  tool: CliRecommendation
  state: CliRuntimeState | undefined
  update: CliRuntimeUpdate | undefined
  busy: boolean
  confirming: boolean
  onSource: (source: CliSource) => void
  onInstall: () => void
  onUninstall: () => void
  onCopy: (command: string) => void
}) {
  const systemAvailable = state?.system.available === true
  const managedInstalled = state?.managed.installed === true
  const chosen = state?.preference ?? defaultSource({ systemAvailable, managedInstalled })
  const effective = state?.effective ?? null
  return (
    <div className="w1-caprow static rec runtime">
      <span className="w1-capglyph">RT</span>
      <span className="w1-capcopy">
        <b>
          {tool.name}
          <i className="w1-capver">环境依赖</i>
          {update?.hasUpdate ? (
            <i className="w1-captags-update">有新版本 {update.latestVersion}</i>
          ) : null}
        </b>
        <p>{tool.summary}</p>
        <p className="w1-capwhy">{tool.why}</p>
        <span className="w1-capsrcseg" role="group" aria-label={`${tool.name} 生效源`}>
          <button
            type="button"
            className={chosen === 'system' ? 'on' : ''}
            aria-pressed={chosen === 'system'}
            disabled={!systemAvailable || busy}
            onClick={() => onSource('system')}
          >
            系统{state?.system.version ? ` ${state.system.version}` : ''}
            {systemAvailable ? '' : ' · 未安装'}
          </button>
          <button
            type="button"
            className={chosen === 'managed' ? 'on' : ''}
            aria-pressed={chosen === 'managed'}
            disabled={!managedInstalled || busy}
            onClick={() => onSource('managed')}
          >
            应用托管{state?.managed.version ? ` ${state.managed.version}` : ''}
            {managedInstalled ? '' : ' · 未安装'}
          </button>
          <i className="w1-capsrcnote">
            {effective ? `生效：${effective === 'system' ? '系统' : '应用托管'}` : '两侧都未安装'}
          </i>
        </span>
      </span>
      <span className="w1-capactions">
        {managedInstalled ? (
          <button
            type="button"
            className="w1-capmini danger"
            disabled={busy}
            aria-label={`卸载 ${tool.id} 托管版本`}
            onClick={onUninstall}
          >
            {confirming ? '确认卸载' : '卸载托管'}
          </button>
        ) : (
          <button
            type="button"
            className="w1-capmini pri"
            disabled={busy}
            aria-label={`安装 ${tool.id} 托管版本`}
            onClick={onInstall}
          >
            {busy ? '安装中…' : '安装托管'}
          </button>
        )}
        {managedInstalled && update?.hasUpdate && effective === 'managed' ? (
          <button
            type="button"
            className="w1-capmini pri"
            disabled={busy}
            aria-label={`更新 ${tool.id} 托管版本`}
            onClick={onInstall}
          >
            {busy ? '更新中…' : `更新到 ${update.latestVersion}`}
          </button>
        ) : null}
        {!managedInstalled || effective === 'system' ? (
          <button
            type="button"
            className="w1-capmini"
            aria-label={`复制 ${tool.name} 安装命令`}
            onClick={() =>
              onCopy(
                update?.hasUpdate && systemAvailable
                  ? `winget upgrade --id ${tool.runtime?.wingetId} -e`
                  : tool.install.command
              )
            }
          >
            {update?.hasUpdate && systemAvailable ? '复制升级命令' : '复制命令'}
          </button>
        ) : null}
        <button
          type="button"
          className="w1-capmini"
          aria-label={`打开 ${tool.name} 仓库`}
          onClick={() => window.open(tool.repo, '_blank', 'noopener')}
        >
          仓库
        </button>
      </span>
    </div>
  )
}

/**
 * 工具推荐：精选 CLI（winget 安装命令已核对），只读展示 + 本地 PATH 检测。
 * 不自动安装、不联网；清单随应用版本更新。
 */
export function RecommendationsTab({ notify, onOpenMarket }: RecommendationsTabProps) {
  const api = typeof window === 'undefined' ? undefined : window.ws?.capability
  const [installed, setInstalled] = useState<Record<string, boolean> | null>(null)
  const [runtimes, setRuntimes] = useState<CliRuntimeState[]>([])
  const [updates, setUpdates] = useState<Record<string, CliRuntimeUpdate>>({})
  const [runtimeBusy, setRuntimeBusy] = useState<string | null>(null)
  const [confirmUninstall, setConfirmUninstall] = useState('')
  const [mcpList, setMcpList] = useState<ExternalMcpServerRecord[]>([])
  const [sources, setSources] = useState<PluginSourceRecord[]>([])
  const [recBusy, setRecBusy] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<CliRecommendCategory | 'all'>('all')

  const loadUpdates = useCallback(() => {
    if (!api?.cliRuntimeUpdates) return
    void api
      .cliRuntimeUpdates()
      .then((list) => setUpdates(Object.fromEntries(list.map((item) => [item.id, item]))))
      .catch(() => {})
  }, [api])

  const loadRuntimes = useCallback(() => {
    if (!api?.cliRuntimes) return
    void api
      .cliRuntimes()
      .then(setRuntimes)
      .catch(() => setRuntimes([]))
  }, [api])

  const load = () => {
    if (!api?.cliRecommend) {
      setInstalled({})
      return
    }
    void api
      .cliRecommend()
      .then(setInstalled)
      .catch(() => setInstalled({}))
  }

  useEffect(() => {
    if (!api) {
      setInstalled({})
      return
    }
    let alive = true
    void api
      .cliRecommend()
      .then((next) => {
        if (alive) setInstalled(next)
      })
      .catch(() => {
        if (alive) setInstalled({})
      })
    loadRuntimes()
    loadUpdates()
    void api.mcp
      .list()
      .then((next) => {
        if (alive) setMcpList(next)
      })
      .catch(() => {
        if (alive) setMcpList([])
      })
    void api
      .pluginSources()
      .then((next) => {
        if (alive) setSources(next)
      })
      .catch(() => {
        if (alive) setSources([])
      })
    return () => {
      alive = false
    }
  }, [api, loadRuntimes, loadUpdates])

  const visible = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    return RECOMMENDED_CLI_TOOLS.filter(
      (tool) =>
        (category === 'all' || tool.category === category) &&
        (!keyword ||
          tool.name.toLowerCase().includes(keyword) ||
          tool.summary.toLowerCase().includes(keyword) ||
          tool.why.toLowerCase().includes(keyword))
    )
  }, [query, category])

  const installedCount = Object.values(installed ?? {}).filter(Boolean).length

  const copyCommand = (command: string) => {
    const done = () => notify(`已复制 ${command}`)
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(command).then(done, () => fallbackCopy(command, done))
      return
    }
    fallbackCopy(command, done)
  }

  const addMcpRecommendation = (rec: McpRecommendation) => {
    if (!api?.mcp || recBusy) return
    setRecBusy(rec.id)
    void api.mcp
      .add({
        name: rec.name,
        transport: 'http',
        url: rec.url,
        auth: rec.auth === 'oauth' ? 'oauth' : 'headers'
      })
      .then((created) => {
        setMcpList((list) => [created, ...list])
        notify(`已添加 ${rec.name} · 去 MCP 页信任${rec.auth === 'oauth' ? '并登录' : ''}后启用`)
      })
      .catch((error: unknown) => notify(error instanceof Error ? error.message : '添加失败'))
      .finally(() => setRecBusy(null))
  }

  const addSkillSource = (rec: SkillSourceRecommendation) => {
    if (!api?.addPluginSource || recBusy) return
    setRecBusy(rec.id)
    void api
      .addPluginSource({ name: rec.sourceName, url: rec.url })
      .then((saved) => {
        setSources((list) => [...list, saved])
        notify(
          saved.lastError
            ? `已添加插件源 ${rec.name} · 市场注册未完成，可在插件页刷新重试`
            : `已添加插件源 ${rec.name} · ${saved.pluginCount} 个插件，去市场安装`
        )
      })
      .catch((error: unknown) => notify(error instanceof Error ? error.message : '添加插件源失败'))
      .finally(() => setRecBusy(null))
  }

  const changeSource = (id: string, source: CliSource) => {
    if (!api?.setCliSource || runtimeBusy) return
    setRuntimeBusy(id)
    void api
      .setCliSource(id, source)
      .then((next) => {
        setRuntimes(next)
        notify(`${id} 生效源：${source === 'system' ? '系统' : '应用托管'}`)
      })
      .catch((error: unknown) => notify(error instanceof Error ? error.message : '源切换失败'))
      .finally(() => setRuntimeBusy(null))
  }

  const installManaged = (id: string) => {
    if (!api?.installCliRuntime || runtimeBusy) return
    setRuntimeBusy(id)
    notify(`开始下载 ${id} 托管版本…`)
    void api
      .installCliRuntime(id)
      .then((next) => {
        setRuntimes(next)
        notify(`${id} 托管版本已安装并校验`)
        loadUpdates()
      })
      .catch((error: unknown) => notify(error instanceof Error ? error.message : '安装失败'))
      .finally(() => setRuntimeBusy(null))
  }

  const uninstallManaged = (id: string) => {
    if (!api?.uninstallCliRuntime || runtimeBusy) return
    if (confirmUninstall !== id) {
      setConfirmUninstall(id)
      notify('再次点击确认卸载托管版本（只删应用目录）')
      return
    }
    setConfirmUninstall('')
    setRuntimeBusy(id)
    void api
      .uninstallCliRuntime(id)
      .then((next) => {
        setRuntimes(next)
        notify(`${id} 托管版本已卸载`)
      })
      .catch((error: unknown) => notify(error instanceof Error ? error.message : '卸载失败'))
      .finally(() => setRuntimeBusy(null))
  }

  const openRepo = (repo: string) => {
    window.open(repo, '_blank', 'noopener')
  }

  return (
    <section className="w1-capsection" aria-label="工具推荐">
      <div className="w1-caphead">
        <span className="w1-capkicker">// TOOLBOX</span>
        <span className="w1-capnote">
          精选 CLI：快、成熟、Windows 可直接 winget 安装；只做本地 PATH 检测，不自动安装、不联网
        </span>
        <div className="w1-capactions">
          <button type="button" className="w1-capmini" onClick={load}>
            重新检测
          </button>
          <button type="button" className="w1-capmini" onClick={loadUpdates}>
            检查更新
          </button>
          <span className="w1-capscope">
            已装 {installedCount}/{RECOMMENDED_CLI_TOOLS.length}
          </span>
        </div>
      </div>

      <div className="w1-capdomain">
        <h4>MCP 服务推荐</h4>
        <div className="w1-caplist">
          {MCP_RECOMMENDATIONS.map((rec) => {
            const added = mcpList.some((server) => server.url === rec.url)
            return (
              <div className="w1-caprow static mcp-rec" key={rec.id}>
                <span className="w1-capglyph">MC</span>
                <span className="w1-capcopy">
                  <b>
                    {rec.name}
                    <i className="w1-capver">{rec.authNote}</i>
                  </b>
                  <p>{rec.summary}</p>
                  <p className="w1-capwhy">{rec.why}</p>
                </span>
                <span className="w1-capactions">
                  {added ? (
                    <span className="w1-capbadge">已添加</span>
                  ) : (
                    <button
                      type="button"
                      className="w1-capmini pri"
                      disabled={recBusy !== null}
                      aria-label={`添加 ${rec.name}`}
                      onClick={() => addMcpRecommendation(rec)}
                    >
                      {recBusy === rec.id ? '添加中…' : '添加'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="w1-capmini"
                    aria-label={`打开 ${rec.name} 文档`}
                    onClick={() => window.open(rec.docs, '_blank', 'noopener')}
                  >
                    文档
                  </button>
                </span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="w1-capdomain">
        <h4>技能库推荐</h4>
        <div className="w1-caplist">
          {SKILL_SOURCE_RECOMMENDATIONS.map((rec) => {
            const added = sources.some((source) => source.url === rec.url)
            return (
              <div className="w1-caprow static skill-rec" key={rec.id}>
                <span className="w1-capglyph">SK</span>
                <span className="w1-capcopy">
                  <b>{rec.name}</b>
                  <p>{rec.summary}</p>
                  <p className="w1-capwhy">{rec.why}</p>
                  <span className="w1-captags">
                    {rec.highlights.map((item) => (
                      <i key={item}>{item}</i>
                    ))}
                  </span>
                </span>
                <span className="w1-capactions">
                  {added ? (
                    <button type="button" className="w1-capmini pri" onClick={onOpenMarket}>
                      去市场
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="w1-capmini pri"
                      disabled={recBusy !== null}
                      aria-label={`添加插件源 ${rec.name}`}
                      onClick={() => addSkillSource(rec)}
                    >
                      {recBusy === rec.id ? '添加中…' : '添加为插件源'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="w1-capmini"
                    aria-label={`打开 ${rec.name} 仓库`}
                    onClick={() => window.open(rec.docs, '_blank', 'noopener')}
                  >
                    仓库
                  </button>
                </span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="w1-capmarketbar">
        <input
          className="w1-capsearch"
          value={query}
          placeholder="搜索工具、用途或理由…"
          aria-label="搜索推荐工具"
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="w1-capseg w1-capsort" role="group" aria-label="按分类筛选">
          <button
            type="button"
            className={category === 'all' ? 'on' : ''}
            aria-pressed={category === 'all'}
            onClick={() => setCategory('all')}
          >
            全部
          </button>
          {CLI_RECOMMEND_CATEGORIES.map((value) => (
            <button
              key={value}
              type="button"
              className={category === value ? 'on' : ''}
              aria-pressed={category === value}
              onClick={() => setCategory(value)}
            >
              {CLI_CATEGORY_LABELS[value]}
            </button>
          ))}
        </div>
      </div>

      {installed === null ? (
        <StatePlaceholder kind="loading" rows={4} />
      ) : visible.length === 0 ? (
        <div className="w1-capemptycard">
          <b>没有匹配的工具。</b>
          <p>换个关键词，或切回「全部」分类。</p>
        </div>
      ) : (
        <div className="w1-caplist">
          {visible.map((tool) => {
            if (tool.runtime) {
              return (
                <RuntimeRow
                  key={tool.id}
                  tool={tool}
                  state={runtimes.find((entry) => entry.id === tool.id)}
                  update={updates[tool.id]}
                  busy={runtimeBusy === tool.id}
                  confirming={confirmUninstall === tool.id}
                  onSource={(source) => changeSource(tool.id, source)}
                  onInstall={() => installManaged(tool.id)}
                  onUninstall={() => uninstallManaged(tool.id)}
                  onCopy={copyCommand}
                />
              )
            }
            const ok = installed[tool.id] === true
            return (
              <div className={`w1-caprow static rec${ok ? ' installed' : ''}`} key={tool.id}>
                <span className="w1-capglyph">CL</span>
                <span className="w1-capcopy">
                  <b>
                    {tool.name}
                    <i className="w1-capver">{CLI_CATEGORY_LABELS[tool.category]}</i>
                  </b>
                  <p>{tool.summary}</p>
                  <p className="w1-capwhy">{tool.why}</p>
                  <code className="w1-capcmd">{tool.install.command}</code>
                </span>
                <span className="w1-capactions">
                  <span className={`w1-capbadge${ok ? '' : ' off'}`}>
                    {ok ? '已安装' : '未安装'}
                  </span>
                  <button
                    type="button"
                    className="w1-capmini"
                    aria-label={`复制 ${tool.name} 安装命令`}
                    onClick={() => copyCommand(tool.install.command)}
                  >
                    复制命令
                  </button>
                  <button
                    type="button"
                    className="w1-capmini"
                    aria-label={`打开 ${tool.name} 仓库`}
                    onClick={() => openRepo(tool.repo)}
                  >
                    仓库
                  </button>
                </span>
              </div>
            )
          })}
        </div>
      )}
      <p className="w1-capnote">
        清单是内置精选（2026-11 核对 winget 官方 ID），不随网络变化；安装后点「重新检测」刷新状态。
        这些是本机命令行工具，不进入 Agent 的工具链路。
      </p>
    </section>
  )
}
