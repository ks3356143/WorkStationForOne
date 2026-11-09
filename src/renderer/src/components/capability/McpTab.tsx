import { Fragment, useEffect, useMemo, useState } from 'react'
import type {
  AgentKind,
  ExternalMcpAuthMode,
  ExternalMcpCatalogEntry,
  ExternalMcpSaveInput,
  ExternalMcpServerRecord,
  ExternalMcpTargets,
  ExternalMcpUpdateInfo,
  McpToolApproval,
  ToolSurfaceMcpRecord
} from '../../../../shared/ipc'
import { friendlyMessage } from '../../lib/errors'
import { replaceById } from '../../lib/collections'
import {
  installedCatalogIds,
  keyPlaceholders,
  mcpStatus,
  mcpTarget,
  parseKeyValueLines
} from '../../lib/capabilities'
import { BeamLayer } from '../effects/BeamLayer'
import { ToolNoteInput } from './ToolNoteInput'

interface McpFormState {
  id?: string
  name: string
  description: string
  transport: 'stdio' | 'http'
  auth: ExternalMcpAuthMode
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

const EMPTY_FORM: McpFormState = {
  name: '',
  description: '',
  transport: 'stdio',
  auth: 'headers',
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
    auth: server.auth,
    command: server.command,
    args: server.args.join('\n'),
    url: server.url,
    env: keyPlaceholders(server.envKeys),
    headers: keyPlaceholders(server.headerKeys),
    targets: server.targets
  }
}

interface McpTabProps {
  notify: (text: string) => void
  agent: AgentKind
  /** 当前 Agent 的工具面 MCP 行：★ / 用途 / 排序 */
  surfaceMcp: ToolSurfaceMcpRecord[]
  priorityBusy: string | null
  onAgent: (agent: AgentKind) => void
  onPreferred: (key: string, preferred: boolean) => void
  onNote: (key: string, note: string) => void
  onMove: (key: string, direction: 'up' | 'down') => void
  /** Server 启停 / 信任 / 增删后刷新工具面快照 */
  onSurfaceDirty: () => void
}

const AGENT_LABELS: Record<AgentKind, string> = { claude: 'Claude', codex: 'Codex' }

/** 「MCP」页：自定义/目录 Server、JSON 导入导出、工具级权限，以及按 Agent 的首选优先级。 */
export function McpTab({
  notify,
  agent,
  surfaceMcp,
  priorityBusy,
  onAgent,
  onPreferred,
  onNote,
  onMove,
  onSurfaceDirty
}: McpTabProps) {
  const api = typeof window === 'undefined' ? undefined : window.ws?.capability
  const [mcp, setMcp] = useState<ExternalMcpServerRecord[]>([])
  const [catalog, setCatalog] = useState<ExternalMcpCatalogEntry[]>([])
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({})
  const [jsonMode, setJsonMode] = useState<'import' | 'export' | null>(null)
  const [jsonText, setJsonText] = useState('')
  const [jsonMessage, setJsonMessage] = useState<string | null>(null)
  const [jsonBusy, setJsonBusy] = useState(false)
  const [mcpBusy, setMcpBusy] = useState<string | null>(null)
  const [updates, setUpdates] = useState<ExternalMcpUpdateInfo[]>([])
  const [updatesBusy, setUpdatesBusy] = useState(false)
  const [form, setForm] = useState<McpFormState | null>(null)
  const [confirmKey, setConfirmKey] = useState('')

  useEffect(() => {
    if (!api) return
    let alive = true
    void Promise.all([api.mcp.list(), api.mcp.catalog()])
      .then(([nextMcp, nextCatalog]) => {
        if (!alive) return
        setMcp(nextMcp)
        setCatalog(nextCatalog)
      })
      .catch((reason: unknown) => {
        if (alive) notify(friendlyMessage(reason, 'MCP 列表读取失败'))
      })
    return () => {
      alive = false
    }
  }, [api, notify])

  const installedCatalog = useMemo(() => installedCatalogIds(mcp), [mcp])

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
        setMcp((list) => replaceById(list, updated))
        notify(
          `${toolName}：${approval === 'allow' ? '自动批准' : approval === 'deny' ? '禁止' : '每次询问'}`
        )
      })
      .catch((reason: unknown) => notify(friendlyMessage(reason, '工具权限更新失败')))
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
        notify(friendlyMessage(reason, '导出 MCP 配置失败'))
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
        onSurfaceDirty()
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
      .catch((reason: unknown) => notify(friendlyMessage(reason, '导入 MCP 配置失败')))
      .finally(() => setJsonBusy(false))
  }

  const selectJson = () => {
    const textarea = document.querySelector<HTMLTextAreaElement>('.w1-capjson')
    textarea?.focus()
    textarea?.select()
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
        setMcp((list) => replaceById(list, updated))
        onSurfaceDirty()
        notify(enable ? `已启用 ${updated.name}` : `已停用 ${updated.name}`)
      })
      .catch((reason: unknown) => notify(friendlyMessage(reason, 'MCP 状态更新失败')))
      .finally(() => setMcpBusy(null))
  }

  const loginMcp = (server: ExternalMcpServerRecord) => {
    if (!api || mcpBusy) return
    setMcpBusy(server.id)
    void api.mcp
      .login(server.id)
      .then((result) => {
        notify(result.message)
        return api.mcp.list()
      })
      .then((list) => setMcp(list))
      .catch((reason: unknown) => notify(friendlyMessage(reason, 'OAuth 登录失败')))
      .finally(() => setMcpBusy(null))
  }

  const logoutMcp = (server: ExternalMcpServerRecord) => {
    if (!api || mcpBusy) return
    setMcpBusy(server.id)
    void api.mcp
      .logout(server.id)
      .then(() => api.mcp.list())
      .then((list) => {
        setMcp(list)
        notify(`已退出 ${server.name} 的 OAuth 登录`)
      })
      .catch((reason: unknown) => notify(friendlyMessage(reason, '退出 OAuth 登录失败')))
      .finally(() => setMcpBusy(null))
  }

  const testMcp = (server: ExternalMcpServerRecord) => {
    if (!api || mcpBusy) return
    setMcpBusy(server.id)
    void api.mcp
      .test(server.id)
      .then((updated) => {
        setMcp((list) => replaceById(list, updated))
        onSurfaceDirty()
        if (updated.lastError) notify(`${updated.name} 测试失败：${updated.lastError}`)
        else notify(`${updated.name} 连接正常 · ${updated.toolNames.length} 个工具`)
      })
      .catch((reason: unknown) => notify(friendlyMessage(reason, 'MCP 测试失败')))
      .finally(() => setMcpBusy(null))
  }

  const addCatalogServer = (entry: ExternalMcpCatalogEntry) => {
    if (!api || mcpBusy) return
    setMcpBusy(entry.id)
    void api.mcp
      .add({ name: entry.name, transport: entry.transport, catalogId: entry.id })
      .then((created) => {
        setMcp((list) => [created, ...list])
        onSurfaceDirty()
        notify(`已添加 ${created.name} · 启用前需确认信任`)
      })
      .catch((reason: unknown) => notify(friendlyMessage(reason, 'MCP 添加失败')))
      .finally(() => setMcpBusy(null))
  }

  const saveForm = () => {
    if (!api || !form || mcpBusy) return
    const input: ExternalMcpSaveInput = {
      name: form.name,
      description: form.description,
      transport: form.transport,
      targets: form.targets,
      auth: form.transport === 'http' ? form.auth : 'headers',
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
      ...(form.transport === 'http' && form.auth === 'oauth'
        ? {}
        : { headers: parseKeyValueLines(form.headers) })
    }
    setMcpBusy('form')
    const request = form.id ? api.mcp.update(form.id, input) : api.mcp.add(input)
    void request
      .then((saved) => {
        setMcp((list) => [saved, ...list.filter((item) => item.id !== saved.id)])
        setForm(null)
        onSurfaceDirty()
        notify(`${saved.name} 已保存 · 启用前需确认信任`)
        setUpdates((list) => list.filter((item) => item.id !== saved.id))
      })
      .catch((reason: unknown) => notify(friendlyMessage(reason, 'MCP 保存失败')))
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
        onSurfaceDirty()
        notify(`已移除 ${server.name}`)
      })
      .catch((reason: unknown) => notify(friendlyMessage(reason, 'MCP 移除失败')))
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
      .catch((reason: unknown) => notify(friendlyMessage(reason, '检查更新失败')))
      .finally(() => setUpdatesBusy(false))
  }

  const applyUpdate = (server: ExternalMcpServerRecord) => {
    if (!api || mcpBusy) return
    setMcpBusy(server.id)
    void api.mcp
      .applyUpdate(server.id)
      .then((updated) => {
        setMcp((list) => replaceById(list, updated))
        onSurfaceDirty()
        setUpdates((list) =>
          list.map((item) =>
            item.id === updated.id
              ? { ...item, currentVersion: updated.version, hasUpdate: false }
              : item
          )
        )
        notify(`${updated.name} 已更新到 ${updated.version}`)
      })
      .catch((reason: unknown) => notify(friendlyMessage(reason, 'MCP 更新失败')))
      .finally(() => setMcpBusy(null))
  }

  if (!api) {
    return <div className="w1-capempty">当前环境没有 preload 桥，MCP 配置不可用。</div>
  }

  return (
    <section className="w1-capsection" aria-label="MCP 服务">
      <div className="w1-caphead">
        <span className="w1-capkicker">// EXTERNAL MCP</span>
        <span className="w1-capnote">★ 首选按 Agent 生效，优先于 CLI 原生工具</span>
        <div className="w1-capactions">
          <div className="w1-capseg" role="group" aria-label="切换 Agent">
            {(['claude', 'codex'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={agent === value ? 'on' : ''}
                aria-pressed={agent === value}
                onClick={() => onAgent(value)}
              >
                {AGENT_LABELS[value]}
              </button>
            ))}
          </div>
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
            {form.transport === 'http' ? (
              <label>
                <span>认证方式</span>
                <select
                  value={form.auth}
                  aria-label="MCP 认证方式"
                  onChange={(event) =>
                    setForm({ ...form, auth: event.target.value as ExternalMcpAuthMode })
                  }
                >
                  <option value="headers">请求头</option>
                  <option value="oauth">OAuth 登录</option>
                </select>
              </label>
            ) : null}
            {form.transport === 'stdio' || form.auth === 'headers' ? (
              <label className="wide">
                <span>请求头（KEY=VALUE，每行一个；留空保留旧值）</span>
                <textarea
                  value={form.headers}
                  rows={2}
                  aria-label="MCP 请求头"
                  onChange={(event) => setForm({ ...form, headers: event.target.value })}
                />
              </label>
            ) : (
              <p className="w1-capnote wide">
                保存后在列表里点「登录」，凭据由浏览器授权后加密存本机；请求头不再使用。
              </p>
            )}
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
          <p>先从内置目录添加，或自定义 stdio / HTTP 服务。新装默认停用，确认命令后才会启用。</p>
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
              const key = `mcp:${server.id}`
              const surfaceItem = surfaceMcp.find((item) => item.id === key)
              const surfaceIndex = surfaceMcp.findIndex((item) => item.id === key)
              return (
                <Fragment key={server.id}>
                  <div className="w1-caprow">
                    {surfaceItem?.preferred ? <BeamLayer /> : null}
                    <span className="w1-capglyph">MC</span>
                    <span className="w1-capcopy">
                      <b>
                        {server.name}
                        <i className="w1-capver">{server.transport}</i>
                        {surfaceItem?.preferred ? <i className="w1-capprefer">首选</i> : null}
                      </b>
                      <p>{mcpTarget(server) || server.description}</p>
                      <span className="w1-captags">
                        <i>{server.source === 'catalog' ? '内置目录' : '自定义'}</i>
                        {server.auth === 'oauth' ? (
                          <i
                            className={
                              server.oauth?.state === 'connected'
                                ? 'oauth-ok'
                                : server.oauth
                                  ? 'warn'
                                  : ''
                            }
                            title={server.oauth?.lastError || ''}
                          >
                            OAuth ·{' '}
                            {server.oauth?.state === 'connected'
                              ? '已连接'
                              : server.oauth?.state === 'expired'
                                ? '已过期'
                                : server.oauth?.state === 'error'
                                  ? '需重新登录'
                                  : '未登录'}
                          </i>
                        ) : null}
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
                        {server.toolNames.length > 5 ? <i>+{server.toolNames.length - 5}</i> : null}
                      </span>
                    </span>
                    <span className="w1-capactions">
                      {surfaceItem ? (
                        <>
                          <button
                            type="button"
                            className={`w1-capprefbtn${surfaceItem.preferred ? ' on' : ''}${surfaceItem.enabled ? '' : ' muted'}`}
                            disabled={priorityBusy === `prefer:${key}`}
                            aria-disabled={!surfaceItem.enabled}
                            aria-pressed={surfaceItem.preferred}
                            aria-label={`${server.name} ${surfaceItem.preferred ? '取消首选' : '设为首选'}`}
                            title={
                              surfaceItem.enabled
                                ? '首选：能做同一件事时先调用它，不改用 CLI 原生工具'
                                : '先启用并信任这个 Server 才能设为首选'
                            }
                            onClick={() => onPreferred(key, !surfaceItem.preferred)}
                          >
                            {surfaceItem.preferred ? '★' : '☆'}
                          </button>
                          <button
                            type="button"
                            className="w1-capmini"
                            disabled={surfaceIndex === 0 || priorityBusy === `move:${key}`}
                            aria-label={`${server.name} 上移`}
                            title={
                              surfaceIndex > 0 &&
                              surfaceItem.preferred !== surfaceMcp[surfaceIndex - 1]?.preferred
                                ? '首选分组固定置顶；先取消 ★ 再和其它项换位'
                                : undefined
                            }
                            onClick={() => onMove(key, 'up')}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="w1-capmini"
                            disabled={
                              surfaceIndex === surfaceMcp.length - 1 ||
                              priorityBusy === `move:${key}`
                            }
                            aria-label={`${server.name} 下移`}
                            title={
                              surfaceIndex < surfaceMcp.length - 1 &&
                              surfaceItem.preferred !== surfaceMcp[surfaceIndex + 1]?.preferred
                                ? '首选分组固定置顶；先取消 ★ 再和其它项换位'
                                : undefined
                            }
                            onClick={() => onMove(key, 'down')}
                          >
                            ↓
                          </button>
                        </>
                      ) : null}
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
                      {server.auth === 'oauth' && server.transport === 'http' ? (
                        <button
                          type="button"
                          className="w1-capmini"
                          disabled={mcpBusy === server.id}
                          onClick={() => loginMcp(server)}
                        >
                          {server.oauth ? '重新登录' : '登录'}
                        </button>
                      ) : null}
                      {server.auth === 'oauth' && server.oauth ? (
                        <button
                          type="button"
                          className="w1-capmini"
                          disabled={mcpBusy === server.id}
                          onClick={() => logoutMcp(server)}
                        >
                          退出登录
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
                    {surfaceItem?.preferred && surfaceItem.enabled ? (
                      <ToolNoteInput
                        value={surfaceItem.note}
                        disabled={priorityBusy === `note:${key}`}
                        onSave={(note) => onNote(key, note)}
                      />
                    ) : null}
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
  )
}
