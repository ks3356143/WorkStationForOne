import { useCallback, useEffect, useState } from 'react'
import { dateKey } from '../../../shared/date-key'
import type { MoodRecord, MoodSaveInput } from '../../../shared/ipc'
import { clampLevel } from './mood'

// 无 preload 桥（浏览器调试 / capture）时的内存退路，与真实桥共用同一组件。
const fallback = new Map<string, MoodRecord>()

function fallbackRecent(): MoodRecord[] {
  return [...fallback.values()].sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, 30)
}

/** 读取今日心情与近 30 天记录，并提供保存；纯展示规则在 lib/mood.ts。 */
export function useMood() {
  const [today, setToday] = useState<MoodRecord | null>(null)
  const [recent, setRecent] = useState<MoodRecord[]>([])
  const [ready, setReady] = useState(false)
  const day = dateKey()

  useEffect(() => {
    let alive = true
    const api = window.ws?.mood
    if (!api) {
      setToday(fallback.get(day) ?? null)
      setRecent(fallbackRecent())
      setReady(true)
      return
    }
    void Promise.all([api.get(day), api.recent(30)])
      .then(([current, list]) => {
        if (!alive) return
        setToday(current)
        setRecent(list)
        setReady(true)
      })
      .catch(() => {
        if (alive) setReady(true)
      })
    return () => {
      alive = false
    }
  }, [day])

  const save = useCallback(async (input: MoodSaveInput): Promise<MoodRecord> => {
    const api = window.ws?.mood
    let record: MoodRecord
    if (api) {
      record = await api.save(input)
    } else {
      record = {
        day: input.day,
        mood: clampLevel(input.mood),
        energy: clampLevel(input.energy),
        note: (input.note ?? '').trim().slice(0, 500),
        updatedAt: Date.now()
      }
      fallback.set(input.day, record)
    }
    setToday(record)
    setRecent((prev) => [record, ...prev.filter((item) => item.day !== record.day)].slice(0, 30))
    return record
  }, [])

  return { today, recent, ready, save }
}
