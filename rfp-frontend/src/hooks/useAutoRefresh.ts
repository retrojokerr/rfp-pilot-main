import { useEffect, useRef } from 'react'

/**
 * Calls `fn` on mount, on window focus, on tab-visible (visibilitychange),
 * and on an interval. The interval only ticks while the tab is visible — a
 * hidden/background tab makes no requests, and firing resumes (immediately)
 * when the tab becomes visible again.
 *
 * `fn` is held in a ref so callers don\'t need to memoize it perfectly; the
 * latest closure is always used without re-arming listeners.
 *
 * @param fn       the fetch/refresh function to run
 * @param enabled  gate (e.g. `mounted`); when false, nothing is scheduled
 * @param interval poll period in ms (default 15s)
 */
export function useAutoRefresh(
  fn: () => void,
  { enabled = true, interval = 15_000 }: { enabled?: boolean; interval?: number } = {},
) {
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    if (!enabled) return

    const run = () => fnRef.current()

    // Initial fetch.
    run()

    // Interval — but skip ticks while the tab is hidden.
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') run()
    }, interval)

    // Refetch the moment the tab regains focus or becomes visible.
    const onFocus = () => run()
    const onVisible = () => { if (document.visibilityState === 'visible') run() }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled, interval])
}
