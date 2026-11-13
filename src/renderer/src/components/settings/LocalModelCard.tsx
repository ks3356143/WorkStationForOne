import { useEffect, useState } from 'react'
import type { LocalModelConfig } from '../../../../shared/ipc'

/** 本机模型（离线摘要）：回环地址 + 模型名，启用后用于会话滚动摘要。 */
export function LocalModelCard({ notify }: { notify: (text: string) => void }) {
  const api = typeof window === 'undefined' ? undefined : window.ws?.agent
  const [enabled, setEnabled] = useState(false)
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!api) {
      setLoaded(true)
      return
    }
    let alive = true
    void api
      .getLocalModel()
      .then((config) => {
        if (!alive) return
        setEnabled(config.enabled)
        setBaseUrl(config.baseUrl)
        setModel(config.model)
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setLoaded(true)
      })
    return () => {
      alive = false
    }
  }, [api])

  const save = () => {
    if (!api || busy) return
    setBusy(true)
    const config: LocalModelConfig = { baseUrl: baseUrl.trim(), model: model.trim(), enabled }
    void api
      .setLocalModel(config)
      .then((saved) => {
        setBaseUrl(saved.baseUrl)
        setModel(saved.model)
        setEnabled(saved.enabled)
        notify(saved.enabled ? '本机模型已启用（仅回环地址）' : '本机模型已停用')
      })
      .catch((error: unknown) =>
        notify(error instanceof Error ? error.message : '保存本机模型失败')
      )
      .finally(() => setBusy(false))
  }

  return (
    <div className="w1-localmodel" aria-label="本机模型">
      <div className="w1-localmodelhead">
        <b>本机模型</b>
        <span>只用 127.0.0.1 / localhost 的 OpenAI 兼容端点做会话摘要，数据不出本机。</span>
      </div>
      <label className="w1-localfield inline">
        <input
          type="checkbox"
          checked={enabled}
          disabled={!loaded}
          onChange={(event) => setEnabled(event.target.checked)}
        />
        <span>启用本机摘要</span>
      </label>
      <div className="w1-localgrid">
        <label className="w1-localfield">
          <span>Base URL</span>
          <input
            value={baseUrl}
            placeholder="http://127.0.0.1:11434"
            disabled={!loaded}
            onChange={(event) => setBaseUrl(event.target.value)}
          />
        </label>
        <label className="w1-localfield">
          <span>模型</span>
          <input
            value={model}
            placeholder="qwen2.5:7b"
            disabled={!loaded}
            onChange={(event) => setModel(event.target.value)}
          />
        </label>
      </div>
      <div className="w1-localops">
        <button type="button" className="w1-capmini pri" disabled={!loaded || busy} onClick={save}>
          {busy ? '保存中…' : '保存本机模型'}
        </button>
        <span className="w1-capnote">抽取式摘要始终保底，本机模型失败不影响回合。</span>
      </div>
    </div>
  )
}
