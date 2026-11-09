import { Fragment, useEffect, useMemo, useState } from 'react'
import type {
  InstalledPluginRecord,
  LocalScanRecord,
  PluginSourceRecord,
  SkillInspection,
  SkillMarketSnapshot,
  SkillRecord
} from '../../../../shared/ipc'
import { friendlyMessage } from '../../lib/errors'
import { replaceById } from '../../lib/collections'
import { filterMarket, formatCount, marketLabel, sortMarket } from '../../lib/capabilities'
import { StatePlaceholder } from '../StatePlaceholder'

interface PluginsTabProps {
  notify: (text: string) => void
  loading: boolean
  skills: SkillRecord[]
  installedCodex: InstalledPluginRecord[]
  /** 安装 / 更新 / 卸载 / 导入后刷新面板共享的插件与工具面状态 */
  onSkillsChanged: () => void
  onOpenSkills: () => void
}

const COMPONENT_LABELS: Record<string, string> = {
  skills: '技能',
  commands: '命令',
  agents: '子代理',
  hooks: 'hooks',
  mcp: 'MCP'
}

/**
 * 插件页：包从哪里来、装没装。市场 / 插件源 / 本机导入 / 更新卸载。
 * 启用、信任与 ★ 首选统一在「技能」页操作，这里只读显示状态。
 */
export function PluginsTab({
  notify,
  loading,
  skills,
  installedCodex,
  onSkillsChanged,
  onOpenSkills
}: PluginsTabProps) {
  const api = typeof window === 'undefined' ? undefined : window.ws?.capability
  const [skillTab, setSkillTab] = useState<'installed' | 'market'>('installed')
  const [market, setMarket] = useState<SkillMarketSnapshot | null>(null)
  const [marketBusy, setMarketBusy] = useState(false)
  const [marketQuery, setMarketQuery] = useState('')
  const [marketSort, setMarketSort] = useState<'popular' | 'name'>('popular')
  const [marketLimit, setMarketLimit] = useState(48)
  const [skillsBusy, setSkillsBusy] = useState<string | null>(null)
  const [detailId, setDetailId] = useState('')
  const [inspection, setInspection] = useState<SkillInspection | null>(null)
  const [detailBusy, setDetailBusy] = useState(false)
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
  const [installedAgent, setInstalledAgent] = useState<'all' | 'claude' | 'codex'>('all')
  const [pluginOpsBusy, setPluginOpsBusy] = useState<string | null>(null)
  const [confirmKey, setConfirmKey] = useState('')

  useEffect(() => {
    if (!api) return
    let alive = true
    void api
      .pluginSources()
      .then((list) => {
        if (alive) setSources(list)
      })
      .catch(() => {
        if (alive) setSources([])
      })
    return () => {
      alive = false
    }
  }, [api])

  const filteredMarket = useMemo(
    () => sortMarket(filterMarket(market?.entries ?? [], marketQuery), marketSort),
    [market, marketQuery, marketSort]
  )
  const visibleMarket = filteredMarket.slice(0, marketLimit)

  const loadMarket = (force: boolean) => {
    if (!api || marketBusy) return
    setMarketBusy(true)
    void api.skills
      .market(force)
      .then((snapshot) => {
        setMarket(snapshot)
        setMarketLimit(48)
        if (snapshot.error) notify(`市场刷新失败：${snapshot.error}`)
      })
      .catch((reason: unknown) => notify(friendlyMessage(reason, 'Claude 市场读取失败')))
      .finally(() => setMarketBusy(false))
  }

  const installSkill = (pluginId: string) => {
    if (!api || skillsBusy) return
    setSkillsBusy(pluginId)
    void api.skills
      .install(pluginId)
      .then((installed) => {
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
        onSkillsChanged()
        notify(`已安装 ${installed.name} · 去「技能」页启用后才会加载`)
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
        setSkillTab('installed')
        onSkillsChanged()
        notify(`已导入 ${plugin.name} · 去「技能」页启用后加载`)
      })
      .catch((reason: unknown) => notify(friendlyMessage(reason, '本地导入失败')))
      .finally(() => setSkillsBusy(null))
  }

  const toggleDetail = (skill: SkillRecord) => {
    if (!api || detailBusy) return
    if (detailId === skill.id) {
      setDetailId('')
      setInspection(null)
      return
    }
    setDetailId(skill.id)
    setInspection(null)
    setDetailBusy(true)
    void api.skills
      .inspect(skill.id)
      .then(setInspection)
      .catch((reason: unknown) => {
        setDetailId('')
        notify(friendlyMessage(reason, '读取技能文件失败'))
      })
      .finally(() => setDetailBusy(false))
  }

  const openFolder = (skill: SkillRecord) => {
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
        onSkillsChanged()
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
        if (detailId === skill.id) {
          setDetailId('')
          setInspection(null)
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
        onSkillsChanged()
        notify(`已移除 ${skill.name}`)
      })
      .catch((reason: unknown) => notify(friendlyMessage(reason, '插件移除失败')))
      .finally(() => setSkillsBusy(null))
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
        onSkillsChanged()
        notify(`已卸载 ${plugin.name}`)
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
      .then((outcome) => {
        const skipped = outcome.skipped.length
        notify(
          `导入 ${outcome.importedMarkets.length} 个市场、${outcome.importedPlugins.length} 个插件${
            skipped > 0 ? ` · ${skipped} 项跳过` : ''
          }`
        )
        void api.pluginSources().then(setSources)
        onSkillsChanged()
      })
      .catch((reason: unknown) => notify(friendlyMessage(reason, '导入失败')))
      .finally(() => setScanBusy(false))
  }

  if (!api) {
    return <div className="w1-capempty">当前环境没有 preload 桥，插件管理不可用。</div>
  }

  return (
    <section className="w1-capsection" aria-label="插件">
      <div className="w1-caphead">
        <span className="w1-capkicker">// PLUGINS</span>
        <span className="w1-capnote">Claude 与 Codex 共用市场清单；只写应用私有目录</span>
        <div className="w1-capactions">
          <div className="w1-capseg" role="group" aria-label="插件视图">
            <button
              type="button"
              className={skillTab === 'installed' ? 'on' : ''}
              aria-pressed={skillTab === 'installed'}
              onClick={() => setSkillTab('installed')}
            >
              已安装 {skills.length + installedCodex.length}
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
                  onChange={(event) => setSourceForm({ ...sourceForm, name: event.target.value })}
                />
              </label>
              <label>
                <span>分支（可选）</span>
                <input
                  value={sourceForm.ref}
                  aria-label="插件源分支"
                  placeholder="main"
                  onChange={(event) => setSourceForm({ ...sourceForm, ref: event.target.value })}
                />
              </label>
              <label className="wide">
                <span>地址</span>
                <input
                  value={sourceForm.url}
                  aria-label="插件源地址"
                  placeholder="owner/repo 或 https://github.com/owner/repo"
                  onChange={(event) => setSourceForm({ ...sourceForm, url: event.target.value })}
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
          <div className="w1-caphead">
            <span className="w1-capnote">启停、信任与 ★ 首选在「技能」页操作</span>
            <div className="w1-capactions">
              <button type="button" className="w1-capmini" onClick={onOpenSkills}>
                去启用
              </button>
            </div>
          </div>
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
                  <div className="w1-caprow static" key={plugin.id}>
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
                        className={`w1-capmini${confirmKey === `plug:${plugin.id}` ? ' danger' : ''}`}
                        disabled={pluginOpsBusy === plugin.id}
                        onClick={() => removeCodexPlugin(plugin)}
                      >
                        {confirmKey === `plug:${plugin.id}` ? '确认卸载' : '卸载'}
                      </button>
                    </span>
                  </div>
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
                        <i>{skill.enabled ? '已启用' : '已停用'}</i>
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
                        className="w1-capmini"
                        disabled={detailBusy}
                        onClick={() => toggleDetail(skill)}
                      >
                        {detailId === skill.id ? '收起' : '详情'}
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
                  {detailId === skill.id ? (
                    <div className="w1-captoolpanel w1-skilldetail">
                      <div className="w1-captoolh">
                        <span>源文件</span>
                        <button
                          type="button"
                          className="w1-capmini"
                          onClick={() => openFolder(skill)}
                        >
                          打开目录
                        </button>
                      </div>
                      {detailBusy ? (
                        <p className="w1-capnote">正在读取插件目录…</p>
                      ) : inspection ? (
                        <>
                          <div className="w1-skillfiles">
                            {inspection.files.slice(0, 40).map((file) => (
                              <span key={file}>{file}</span>
                            ))}
                            {inspection.files.length > 40 ? (
                              <span>+{inspection.files.length - 40} 个文件</span>
                            ) : null}
                          </div>
                          {inspection.docs.length === 0 ? (
                            <p className="w1-capnote">
                              没有 SKILL.md；这个插件可能只包含 commands / agents。
                            </p>
                          ) : (
                            inspection.docs.map((doc) => (
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
              placeholder="搜索市场插件…"
              aria-label="搜索市场插件"
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
              <b>正在读取市场…</b>
              <p>首次会拉取应用私有的官方市场镜像，可能需要 1–2 分钟；不会写全局配置。</p>
            </div>
          ) : filteredMarket.length === 0 ? (
            <div className="w1-capemptycard">
              <b>{market ? '没有匹配的插件。' : '还没有读取市场。'}</b>
              <p>市场只作为下载源；安装记录保存在应用自己的目录。</p>
              {!market ? (
                <button className="w1-pb pri" type="button" onClick={() => loadMarket(true)}>
                  连接市场
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
            市场供 Claude 会话加载（通过 --plugin-dir 按会话生效）。Codex
            插件从同一份市场清单经本机导入或插件源安装，装完后同步一份 skill 到应用私有的
            codex-home。用户级 ~/.claude 设置不参与；工作区自带的项目技能仍按项目上下文加载。
          </p>
        </div>
      )}
    </section>
  )
}
