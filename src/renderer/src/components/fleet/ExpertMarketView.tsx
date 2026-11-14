import type { CSSProperties } from 'react'
import { useListAnimate } from '../../lib/use-list-animate'
import { PanelLoadError } from '../PanelLoadError'
import type { ExpertMarketState } from './useExpertMarket'

/** 专家市场视图：源管理 + 条目筛选导入；状态与操作由 useExpertMarket 提供。 */
export function ExpertMarketView({ market }: { market: ExpertMarketState }) {
  const {
    sources,
    entries,
    marketBusy,
    marketError,
    query,
    setQuery,
    sourceFilter,
    setSourceFilter,
    srcForm,
    setSrcForm,
    importingKey,
    filteredEntries,
    reloadMarket,
    addSource,
    importEntry,
    refreshSource,
    removeSource
  } = market
  const srcListAnim = useListAnimate<HTMLDivElement>()
  const entryListAnim = useListAnimate<HTMLDivElement>()
  return (
    <div className="w1-expmarket">
      <div className="w1-fleetusagehead">
        <span>// 专家市场 · Git 源里的子代理 Markdown</span>
        <span>{marketBusy ? '读取中…' : `${entries.length} 个条目`}</span>
      </div>
      {marketError ? <PanelLoadError message={marketError} onRetry={reloadMarket} /> : null}
      <div className="w1-expsrcform">
        <input
          placeholder="源名称"
          value={srcForm.name}
          maxLength={60}
          onChange={(e) => setSrcForm((f) => ({ ...f, name: e.target.value }))}
        />
        <input
          placeholder="owner/repo 或 HTTPS / 本地绝对路径"
          value={srcForm.url}
          onChange={(e) => setSrcForm((f) => ({ ...f, url: e.target.value }))}
        />
        <input
          placeholder="分支（可选）"
          value={srcForm.ref}
          onChange={(e) => setSrcForm((f) => ({ ...f, ref: e.target.value }))}
        />
        <button
          type="button"
          className="w1-capmini pri"
          disabled={marketBusy || !srcForm.name.trim() || !srcForm.url.trim()}
          onClick={addSource}
        >
          添加源
        </button>
      </div>
      <div className="w1-expsrclist" ref={srcListAnim}>
        {sources.map((source, index) => (
          <div className="w1-expsrcrow" key={source.id} style={{ '--i': index } as CSSProperties}>
            <div className="w1-expmain">
              <b>{source.name}</b>
              <span title={source.url}>{source.url}</span>
              {source.lastError ? <small className="w1-experr">{source.lastError}</small> : null}
            </div>
            <span className="w1-expops">
              <button
                type="button"
                className="w1-fleetopen"
                disabled={marketBusy}
                onClick={() => refreshSource(source.id)}
              >
                刷新
              </button>
              <button
                type="button"
                className="w1-fleetarchive"
                disabled={marketBusy}
                onClick={() => removeSource(source.id)}
              >
                移除
              </button>
            </span>
          </div>
        ))}
        {sources.length === 0 ? (
          <p className="w1-fleetnone">还没有市场源，添加一个 Git 仓库或本地目录。</p>
        ) : null}
      </div>
      <div className="w1-expmarketfilters">
        <input placeholder="搜索专家…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
          <option value="">全部源</option>
          {sources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.name}
            </option>
          ))}
        </select>
      </div>
      <div className="w1-expentrylist" ref={entryListAnim}>
        {filteredEntries.map((entry, index) => {
          const key = `${entry.sourceId}:${entry.relPath}`
          return (
            <div className="w1-exprow" key={key} style={{ '--i': index } as CSSProperties}>
              <div className="w1-expmain">
                <b>{entry.name}</b>
                <span>{entry.description}</span>
                <small>
                  {entry.sourceName} · {entry.relPath}
                </small>
              </div>
              <span className="w1-expops">
                <button
                  type="button"
                  className="w1-fleetopen"
                  disabled={importingKey !== null}
                  onClick={() => importEntry(entry)}
                >
                  {importingKey === key ? '导入中…' : '导入'}
                </button>
              </span>
            </div>
          )
        })}
        {filteredEntries.length === 0 ? <p className="w1-fleetnone">没有匹配的专家条目。</p> : null}
      </div>
    </div>
  )
}
