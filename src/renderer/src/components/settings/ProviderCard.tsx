import { useEffect, useRef, useState } from 'react'
import { m } from 'motion/react'
import type { ProviderProfileRecord, ProviderTarget, ProviderWireApi } from '../../../../shared/ipc'
import { providerAuthScheme, providerEndpoint } from '../../../../shared/provider-profile'
import { DURATION, EASE_OUT } from '../../lib/motion'
import { ClaudeGlyph, CodexGlyph } from '../Glyphs'

type ProviderTestState =
  | { kind: 'testing'; message: string }
  | { kind: 'ok' | 'fail'; message: string; latencyMs?: number }
  | null

type ProviderModelsState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ok'; models: string[]; message: string }
  | { kind: 'fail'; message: string }

interface ProviderCardProps {
  notify: (text: string) => void
}

/**
 * Provider 接线台：目标、继承/自定义、测试连接、拉取模型与加密保存。
 * 状态与请求都留在这里，设置页只负责挂载；密钥不离开主进程回显。
 */
export function ProviderCard({ notify }: ProviderCardProps) {
  const api = typeof window === 'undefined' ? undefined : window.ws?.provider
  const [profiles, setProfiles] = useState<ProviderProfileRecord[]>([])
  const [target, setTarget] = useState<ProviderTarget>('claude')
  const [wireApi, setWireApi] = useState<ProviderWireApi>('responses')
  const [mode, setMode] = useState<'inherit' | 'custom'>('inherit')
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [model, setModel] = useState('')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [test, setTest] = useState<ProviderTestState>(null)
  const testSeq = useRef(0)
  const [models, setModels] = useState<ProviderModelsState>({ kind: 'idle' })
  const modelsSeq = useRef(0)
  const modelsLoading = models.kind === 'loading'

  const activeProfile = profiles.find((profile) => profile.target === target && profile.active)
  const label = target === 'claude' ? 'Claude Code' : 'Codex CLI'
  const endpointHint = providerEndpoint(target, url)
  const authHint =
    target === 'codex'
      ? 'Bearer'
      : providerAuthScheme(target, url) === 'api-key'
        ? 'x-api-key · 官方'
        : 'Bearer · 兼容端点'
  const state = busy
    ? '同步中'
    : activeProfile
      ? '已启用'
      : mode === 'inherit'
        ? '继承中'
        : '待保存'
  const stateTone = busy ? 'idle' : activeProfile ? 'on' : mode === 'inherit' ? 'inherit' : 'idle'
  const glyph =
    target === 'claude' ? (
      <ClaudeGlyph width={15} height={15} />
    ) : (
      <CodexGlyph width={15} height={15} />
    )
  const testing = test?.kind === 'testing'
  const canTest =
    Boolean(api) &&
    !busy &&
    !testing &&
    Boolean(url.trim()) &&
    Boolean(model.trim()) &&
    Boolean(key.trim() || activeProfile?.hasToken)

  const applyTarget = (next: ProviderTarget, list = profiles) => {
    const active = list.find((profile) => profile.target === next && profile.active)
    setMode(active ? 'custom' : 'inherit')
    setName(active?.name ?? '')
    setUrl(active?.baseUrl ?? '')
    setModel(active?.model ?? '')
    setWireApi(next === 'codex' ? 'responses' : (active?.wireApi ?? 'responses'))
    setKey('')
  }

  useEffect(() => {
    void api
      ?.list()
      .then((list) => {
        setProfiles(list)
        const active = list.find((profile) => profile.target === 'claude' && profile.active)
        if (active) {
          setMode('custom')
          setName(active.name)
          setUrl(active.baseUrl)
          setModel(active.model)
          setWireApi(active.wireApi)
        }
      })
      .catch(() => setProfiles([]))
  }, [api])

  // biome-ignore lint/correctness/useExhaustiveDependencies: 目标/模式/表单变化时要清空上一次测试结果
  useEffect(() => {
    testSeq.current += 1
    setTest(null)
  }, [target, mode, url, model, key])

  // biome-ignore lint/correctness/useExhaustiveDependencies: 目标/模式/端点变化时清空旧模型列表
  useEffect(() => {
    modelsSeq.current += 1
    setModels({ kind: 'idle' })
  }, [target, mode, url, key])

  const switchTarget = (next: ProviderTarget) => {
    setTarget(next)
    applyTarget(next)
  }

  const selectInherited = () => {
    setMode('inherit')
    setProfiles((list) =>
      list.map((profile) => (profile.target === target ? { ...profile, active: false } : profile))
    )
    if (!api) return
    setBusy(true)
    void api
      .setActive(target, null)
      .then(() => {
        window.dispatchEvent(new Event('ws:provider-changed'))
        notify(`已改为继承 ${label} 配置`)
      })
      .catch((error: unknown) => notify(error instanceof Error ? error.message : '切换失败'))
      .finally(() => setBusy(false))
  }

  const runTest = () => {
    if (!api || testing) return
    const baseUrl = url.trim()
    const modelName = model.trim()
    const apiKey = key.trim()
    if (!baseUrl || !modelName) {
      notify('先填 Base URL 与模型')
      return
    }
    if (!apiKey && !activeProfile?.hasToken) {
      notify('先填 API Key')
      return
    }
    setTest({ kind: 'testing', message: '正在验证端点与凭据…' })
    const seq = ++testSeq.current
    void api
      .test({
        ...(activeProfile ? { id: activeProfile.id } : {}),
        target,
        wireApi,
        baseUrl,
        model: modelName,
        ...(apiKey ? { apiKey } : {})
      })
      .then((result) => {
        if (seq !== testSeq.current) return
        setTest({
          kind: result.ok ? 'ok' : 'fail',
          message: result.message,
          ...(result.ok ? { latencyMs: result.latencyMs } : {})
        })
      })
      .catch((error: unknown) => {
        if (seq !== testSeq.current) return
        setTest({ kind: 'fail', message: error instanceof Error ? error.message : '测试失败' })
      })
  }

  const loadModels = () => {
    if (!api || modelsLoading) return
    const baseUrl = url.trim()
    const apiKey = key.trim()
    if (!baseUrl) {
      notify('先填 Base URL')
      return
    }
    if (!apiKey && !activeProfile?.hasToken) {
      notify('先填 API Key')
      return
    }
    setModels({ kind: 'loading' })
    const seq = ++modelsSeq.current
    void api
      .listModels({
        ...(activeProfile ? { id: activeProfile.id } : {}),
        target,
        wireApi: target === 'codex' ? 'responses' : wireApi,
        baseUrl,
        ...(apiKey ? { apiKey } : {})
      })
      .then((result) => {
        if (seq !== modelsSeq.current) return
        setModels(
          result.ok
            ? { kind: 'ok', models: result.models, message: result.message }
            : { kind: 'fail', message: result.message }
        )
      })
      .catch((error: unknown) => {
        if (seq !== modelsSeq.current) return
        setModels({
          kind: 'fail',
          message: error instanceof Error ? error.message : '拉取模型失败'
        })
      })
  }

  const save = () => {
    if (!api || busy) return
    const nameValue = name.trim()
    const baseUrl = url.trim()
    const modelName = model.trim()
    const apiKey = key.trim()
    if (!nameValue || !baseUrl || !modelName) {
      notify('先填名称、Base URL 与模型')
      return
    }
    if (!activeProfile?.hasToken && !apiKey) {
      notify('还没有保存 API Key')
      return
    }
    setBusy(true)
    void api
      .save({
        ...(activeProfile ? { id: activeProfile.id } : {}),
        name: nameValue,
        target,
        wireApi,
        baseUrl,
        model: modelName,
        ...(apiKey ? { apiKey } : {})
      })
      .then((saved) => {
        setProfiles((list) => [
          ...list
            .filter((profile) => profile.id !== saved.id)
            .map((profile) =>
              profile.target === saved.target ? { ...profile, active: false } : profile
            ),
          saved
        ])
        setTarget(saved.target)
        setWireApi(saved.wireApi)
        setMode('custom')
        setKey('')
        setTest(null)
        window.dispatchEvent(new Event('ws:provider-changed'))
        notify('Provider 已保存并启用')
      })
      .catch((error: unknown) =>
        notify(error instanceof Error ? `保存失败：${error.message}` : '保存失败')
      )
      .finally(() => setBusy(false))
  }

  return (
    <section className="w1-setgroup" aria-label="Agent Provider">
      <h3>Agent Provider</h3>
      <div className="w1-provcard">
        <div className="w1-provdeckhead">
          <span className="w1-provkicker">// CONNECTION BUS</span>
          <span className={`w1-provstate ${stateTone}`}>
            <i aria-hidden="true" />
            {state}
          </span>
        </div>

        <div className="w1-provseg w1-provports" role="group" aria-label="Provider 目标">
          <button
            type="button"
            data-target="claude"
            className={`w1-provport${target === 'claude' ? ' on' : ''}`}
            aria-pressed={target === 'claude'}
            disabled={busy}
            onClick={() => switchTarget('claude')}
          >
            <span className="w1-provportglyph">
              <ClaudeGlyph width={15} height={15} />
            </span>
            <span className="w1-provportcopy">
              <b>Claude Code</b>
              <i>{target === 'claude' ? '当前目标' : '切换目标'}</i>
            </span>
            <span className="w1-provled" aria-hidden="true" />
          </button>
          <button
            type="button"
            data-target="codex"
            className={`w1-provport${target === 'codex' ? ' on' : ''}`}
            aria-pressed={target === 'codex'}
            disabled={busy}
            onClick={() => switchTarget('codex')}
          >
            <span className="w1-provportglyph">
              <CodexGlyph width={15} height={15} />
            </span>
            <span className="w1-provportcopy">
              <b>Codex CLI</b>
              <i>{target === 'codex' ? '当前目标' : '切换目标'}</i>
            </span>
            <span className="w1-provled" aria-hidden="true" />
          </button>
        </div>

        <div className="w1-provbus" aria-hidden="true" />

        <div className="w1-provroute">
          <span>路由</span>
          <div className="w1-provseg" role="group" aria-label="Provider 模式">
            <button
              type="button"
              className={mode === 'inherit' ? 'on' : ''}
              aria-pressed={mode === 'inherit'}
              disabled={busy}
              onClick={selectInherited}
            >
              继承 {label}
            </button>
            <button
              type="button"
              className={mode === 'custom' ? 'on' : ''}
              aria-pressed={mode === 'custom'}
              disabled={busy}
              onClick={() => setMode('custom')}
            >
              自定义
            </button>
          </div>
        </div>

        <m.div
          key={`${target}-${mode}`}
          className="w1-provbody"
          initial={{ opacity: 0, transform: 'translateY(4px)' }}
          animate={{ opacity: 1, transform: 'translateY(0px)' }}
          transition={{ duration: DURATION.reveal, ease: EASE_OUT }}
        >
          {mode === 'inherit' ? (
            <div className="w1-provinherit">
              <span className="w1-provinheritglyph">{glyph}</span>
              <span className="w1-provinheritcopy">
                <b>沿用本机 {label}</b>
                <p>
                  {target === 'claude'
                    ? '使用 Claude CLI 自己的登录与 settings；本应用不会改写 CC Switch 或桌面配置。'
                    : '使用 Codex CLI 自己的登录与配置；本应用不会改写 ~/.codex 或 CC Switch。'}
                </p>
              </span>
              <span className="w1-provbadge">外部配置不变</span>
            </div>
          ) : (
            <div className="w1-provconn">
              {target === 'codex' ? (
                <div className="w1-provprotocol">
                  <div className="w1-provseg" role="group" aria-label="Codex 协议">
                    <button type="button" className="on" aria-pressed="true" disabled>
                      Responses
                    </button>
                  </div>
                  <span className="w1-provnote">Codex 0.166 仅支持 Responses</span>
                </div>
              ) : null}
              <div className="w1-provfields">
                <label className="w1-provfield">
                  <span>名称</span>
                  <input
                    value={name}
                    placeholder="DeepSeek 代理"
                    aria-label="Provider 名称"
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <div className="w1-provfield">
                  <span>模型</span>
                  <div className="w1-provmodelrow">
                    <input
                      value={model}
                      placeholder="deepseek-flash"
                      aria-label="Provider 模型"
                      spellCheck={false}
                      onChange={(event) => setModel(event.target.value)}
                    />
                    <button
                      type="button"
                      className="w1-setbtn"
                      disabled={modelsLoading || busy || !url.trim()}
                      onClick={loadModels}
                    >
                      {modelsLoading ? '拉取中…' : '拉取模型'}
                    </button>
                  </div>
                  {models.kind === 'ok' && models.models.length > 0 ? (
                    <div className="w1-provmodels" role="listbox" aria-label="模型列表">
                      {models.models.map((item) => (
                        <button
                          key={item}
                          type="button"
                          role="option"
                          aria-selected={model === item}
                          onClick={() => {
                            setModel(item)
                            setModels({ kind: 'idle' })
                          }}
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  ) : models.kind === 'ok' || models.kind === 'fail' ? (
                    <p className="w1-provnote" role="status" aria-live="polite">
                      {models.message}
                    </p>
                  ) : null}
                </div>
                <label className="w1-provfield wide">
                  <span>Base URL</span>
                  <input
                    value={url}
                    placeholder="https://api.deepseek.com"
                    aria-label="Provider Base URL"
                    spellCheck={false}
                    onChange={(event) => setUrl(event.target.value)}
                  />
                </label>
                {endpointHint ? (
                  <div className="w1-provmeta" role="group" aria-label="Provider 连接详情">
                    <span className="w1-provmetachip">
                      <i>鉴权</i>
                      <b>{authHint}</b>
                    </span>
                    <span className="w1-provmetachip w1-provmetaendpoint" title={endpointHint}>
                      <i>端点</i>
                      <b>{endpointHint}</b>
                    </span>
                  </div>
                ) : null}
                <label className="w1-provfield wide">
                  <span>API Key</span>
                  <div className="w1-provkey">
                    <input
                      type="password"
                      value={key}
                      autoComplete="off"
                      placeholder={activeProfile?.hasToken ? '已保存，留空则保留' : '粘贴 API Key'}
                      aria-label="Provider API Key"
                      onChange={(event) => setKey(event.target.value)}
                    />
                    <span className={`w1-provkeytag${activeProfile?.hasToken ? ' on' : ''}`}>
                      {activeProfile?.hasToken ? '已加密' : '待填写'}
                    </span>
                  </div>
                </label>
              </div>
              <div className="w1-provfoot">
                <span className="w1-provfootstate">
                  <span className={`w1-provled${activeProfile ? ' on' : ''}`} aria-hidden="true" />
                  <span className={`w1-provstatus${activeProfile ? ' on' : ''}`}>
                    {activeProfile
                      ? `${activeProfile.name} · 已加密保存`
                      : api
                        ? '填写后保存并启用'
                        : '仅在桌面应用可用'}
                  </span>
                </span>
                <button className="w1-provtest" type="button" disabled={!canTest} onClick={runTest}>
                  {testing ? '测试中…' : '测试连接'}
                </button>
                <button
                  className="w1-provsave"
                  type="button"
                  disabled={busy || testing || !api}
                  onClick={save}
                >
                  {busy ? '保存中…' : '保存并启用'}
                </button>
              </div>
              {test ? (
                <p className={`w1-provtestresult ${test.kind}`} role="status" aria-live="polite">
                  <span className="w1-provled" aria-hidden="true" />
                  <span>
                    {test.kind === 'ok'
                      ? `${test.message} · ${test.latencyMs ?? 0} ms`
                      : test.message}
                  </span>
                </p>
              ) : null}
              <p className="w1-provnote">
                API Key 用系统加密存本机，永不回显；只影响本应用启动的 {label} 进程。
              </p>
            </div>
          )}
        </m.div>
      </div>
    </section>
  )
}
