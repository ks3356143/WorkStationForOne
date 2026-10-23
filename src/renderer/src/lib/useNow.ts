import { useEffect, useState } from 'react'

export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let timer: number | null = null

    const stop = () => {
      if (timer === null) return
      window.clearInterval(timer)
      timer = null
    }

    const start = () => {
      stop()
      timer = window.setInterval(() => setNow(new Date()), intervalMs)
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        setNow(new Date())
        start()
      } else {
        stop()
      }
    }

    start()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [intervalMs])

  return now
}
