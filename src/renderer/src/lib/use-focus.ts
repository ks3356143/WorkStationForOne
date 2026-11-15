import { useCallback, useEffect, useState } from 'react'
import type { FocusRecord } from '../../../shared/ipc'

/** 读取近 7 天专注记录供统计；专注落库由 FocusOverlay 完成，这里只读。 */
export function useFocus() {
  const [recent, setRecent] = useState<FocusRecord[]>([])
  const [ready, setReady] = useState(false)

  const refresh = useCallback(() => {
    const api = window.ws?.focus
    if (!api) {
      setReady(true)
      return
    }
    void api
      .recent(7)
      .then((list) => {
        setRecent(list)
        setReady(true)
      })
      .catch(() => setReady(true))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { recent, ready, refresh }
}
