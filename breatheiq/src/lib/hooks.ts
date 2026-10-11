import { useCallback, useEffect, useRef, useState } from 'react'

/** Re-render every `ms` — for "updated N s ago" labels. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(id)
  }, [ms])
  return now
}

/** Polls `fn` every `ms` while `enabled`. Keeps the last good result if a poll fails. */
export function usePoll<T>(fn: () => Promise<T>, ms: number, enabled = true) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(fn)
  useEffect(() => {
    latest.current = fn
  })
  const refresh = useCallback(() => {
    latest.current().then(
      (d) => { setData(d); setError(null) },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    )
  }, [])
  useEffect(() => {
    if (!enabled) return
    refresh()
    const id = window.setInterval(refresh, ms)
    return () => window.clearInterval(id)
  }, [ms, enabled, refresh])
  return { data, error, refresh }
}
