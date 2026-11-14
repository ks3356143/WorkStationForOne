import { useState } from 'react'
import type { ExpertApi, ExpertMarketEntry, ExpertSourceRecord } from '../../../../shared/ipc'

const errText = (error: unknown): string => (error instanceof Error ? error.message : '操作失败')

/** 专家市场的状态与操作；状态挂在调用方（面板）上，关闭市场再打开不丢查询与源表单。 */
export function useExpertMarket(
  api: ExpertApi | undefined,
  notify: (text: string) => void,
  onImported: () => void
) {
  const [sources, setSources] = useState<ExpertSourceRecord[]>([])
  const [entries, setEntries] = useState<ExpertMarketEntry[]>([])
  const [marketBusy, setMarketBusy] = useState(false)
  const [marketError, setMarketError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [srcForm, setSrcForm] = useState({ name: '', url: '', ref: '' })
  const [importingKey, setImportingKey] = useState<string | null>(null)

  const reloadMarket = () => {
    if (!api) return
    setMarketBusy(true)
    void Promise.all([api.market.sources(), api.market.list()])
      .then(([nextSources, nextEntries]) => {
        setSources(nextSources)
        setEntries(nextEntries)
        setMarketError(null)
      })
      .catch((error: unknown) => setMarketError(errText(error)))
      .finally(() => setMarketBusy(false))
  }

  const addSource = () => {
    if (!api || marketBusy) return
    setMarketBusy(true)
    void api.market
      .addSource({ name: srcForm.name, url: srcForm.url, ref: srcForm.ref || undefined })
      .then(() => {
        setSrcForm({ name: '', url: '', ref: '' })
        reloadMarket()
        notify('已添加专家源')
      })
      .catch((error: unknown) => notify(errText(error)))
      .finally(() => setMarketBusy(false))
  }

  const importEntry = (entry: ExpertMarketEntry) => {
    if (!api || importingKey) return
    const key = `${entry.sourceId}:${entry.relPath}`
    setImportingKey(key)
    void api.market
      .import(entry.sourceId, entry.relPath)
      .then((saved) => {
        onImported()
        notify(`已导入专家：${saved.name}`)
      })
      .catch((error: unknown) => notify(errText(error)))
      .finally(() => setImportingKey(null))
  }

  const refreshSource = (sourceId: string) => {
    if (!api) return
    setMarketBusy(true)
    void api.market
      .refresh(sourceId)
      .then(reloadMarket)
      .catch((error: unknown) => notify(errText(error)))
      .finally(() => setMarketBusy(false))
  }

  const removeSource = (sourceId: string) => {
    if (!api) return
    void api.market
      .removeSource(sourceId)
      .then(reloadMarket)
      .catch((error: unknown) => notify(errText(error)))
  }

  const filteredEntries = entries.filter((entry) => {
    if (sourceFilter && entry.sourceId !== sourceFilter) return false
    if (!query.trim()) return true
    const needle = query.trim().toLowerCase()
    return (
      entry.name.toLowerCase().includes(needle) ||
      entry.description.toLowerCase().includes(needle) ||
      entry.id.toLowerCase().includes(needle)
    )
  })

  return {
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
  }
}

export type ExpertMarketState = ReturnType<typeof useExpertMarket>
