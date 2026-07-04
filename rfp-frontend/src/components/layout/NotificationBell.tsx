'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Bell, Check } from 'lucide-react'
import { cn, formatRelativeTime } from '@/utils/helpers'
import {
  fetchNotifications, markNotificationRead, markAllNotificationsRead,
  type AppNotification,
} from '@/services/api'
import { useAutoRefresh } from '@/hooks/useAutoRefresh'

export default function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<AppNotification[]>([])
  const [unread, setUnread] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const pathname = usePathname()
  const router = useRouter()

  const load = useCallback(() => {
    fetchNotifications()
      .then(({ notifications, unread }) => {
        setItems(notifications)
        setUnread(unread)
      })
      .catch(() => { /* leave state as-is on error; bell is non-critical */ })
  }, [])

  // Load on mount + focus + tab-visible + short interval, plus route change.
  useAutoRefresh(load)
  useEffect(() => { load() }, [pathname, load])

  // Close popover on outside click.
  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  async function handleOpen(n: AppNotification) {
    setOpen(false)
    if (!n.read) {
      try {
        await markNotificationRead(n.id)
        setItems((prev) => prev.map((x) => x.id === n.id ? { ...x, read: true } : x))
        setUnread((u) => Math.max(0, u - 1))
      } catch { /* navigate anyway */ }
    }
    if (n.link) router.push(n.link)
  }

  async function handleMarkAll() {
    try {
      await markAllNotificationsRead()
      setItems((prev) => prev.map((x) => ({ ...x, read: true })))
      setUnread(0)
    } catch { /* no-op */ }
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative p-1.5 rounded text-muted-foreground hover:text-foreground transition-colors"
        title="Notifications"
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
      >
        <Bell className="w-4 h-4" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[15px] h-[15px] px-1 flex items-center justify-center
                           bg-amber-500 text-white text-[9px] font-bold rounded-full leading-none">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-80 max-h-96 flex flex-col
                        bg-popover border border-border rounded-xl shadow-lg overflow-hidden z-50">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
            <span className="text-sm font-semibold text-foreground">Notifications</span>
            {unread > 0 && (
              <button onClick={handleMarkAll}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
                <Check className="w-3 h-3" /> Mark all read
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {items.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                No notifications yet
              </div>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => handleOpen(n)}
                  className={cn(
                    'w-full text-left px-4 py-3 border-b border-border/50 last:border-0',
                    'hover:bg-muted/50 transition-colors',
                    !n.read && 'bg-amber-50/50 dark:bg-amber-950/20',
                  )}
                >
                  <div className="flex items-start gap-2">
                    {!n.read && <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />}
                    <div className={cn('flex-1 min-w-0', n.read && 'pl-3.5')}>
                      <p className="text-xs text-foreground leading-snug">{n.message}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {formatRelativeTime(n.created_at ?? new Date().toISOString())}
                      </p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
