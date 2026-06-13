'use client'

import { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { FileSpreadsheet, Download, Clock, Search, CheckCircle2, Trash2 } from 'lucide-react'
import { cn, formatRelativeTime, formatConfidence } from '@/utils/helpers'
import { useHistoryStore, type RfiHistoryEntry } from '@/stores/historyStore'
import { toast } from 'sonner'

const STATUS_BADGE: Record<RfiHistoryEntry['status'], { label: string; cls: string }> = {
  in_progress: { label: 'In progress', cls: 'badge-neutral' },
  generated: { label: 'Generated', cls: 'badge-info' },
  exported: { label: 'Exported', cls: 'badge-success' },
}

export default function HistoryPage() {
  // zustand-persist hydration guard (avoids SSR/client mismatch)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const entries = useHistoryStore((s) => s.entries)
  const removeEntry = useHistoryStore((s) => s.removeEntry)
  const load = useHistoryStore((s) => s.load)
  useEffect(() => { load() }, [load])
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(
      (e) =>
        e.filename.toLowerCase().includes(q) ||
        (e.exportedAs ?? '').toLowerCase().includes(q)
    )
  }, [entries, search])

  if (!mounted) return null

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">History</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Every RFI you've processed — original file, progress, and exports.
          </p>
        </div>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by file name…"
            aria-label="Search history"
            className="field pl-9 w-64"
          />
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="panel p-10 text-center">
          <FileSpreadsheet className="w-8 h-8 text-muted-foreground/50 mx-auto mb-3" />
          <p className="text-sm font-medium">
            {entries.length === 0 ? 'No RFIs yet' : 'No matches'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {entries.length === 0
              ? 'Upload a workbook in the Workspace to get started — it will appear here automatically.'
              : 'Try a different search term.'}
          </p>
        </div>
      )}

      <div className="space-y-3">
        {filtered.map((e, i) => {
          const badge = STATUS_BADGE[e.status]
          const progress = e.selectedCount > 0
            ? Math.round((e.answered / e.selectedCount) * 100)
            : 0
          return (
            <motion.div
              key={e.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.15, delay: Math.min(i * 0.03, 0.3) }}
              className="panel p-4"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                    <FileSpreadsheet className="w-4.5 h-4.5 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium truncate">{e.filename}</p>
                      <span className={badge.cls}>{badge.label}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-2xs text-muted-foreground flex-wrap tnum">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatRelativeTime(e.uploadedAt)}
                      </span>
                      {e.ownerName && <span>by {e.ownerName}</span>}
                      <span>{e.sheetCount} sheet{e.sheetCount === 1 ? '' : 's'}</span>
                      <span>{e.totalQuestions} questions extracted</span>
                      {e.selectedCount > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          {e.answered}/{e.selectedCount} answered ({progress}%)
                        </span>
                      )}
                      {e.needsReview > 0 && (
                        <span className="text-warning">{e.needsReview} need review</span>
                      )}
                      {e.errors > 0 && (
                        <span className="text-danger">{e.errors} failed</span>
                      )}
                      {e.avgConfidence > 0 && (
                        <span>avg confidence {formatConfidence(e.avgConfidence)}</span>
                      )}
                    </div>
                    {e.exportedAs && (
                      <div className="flex items-center gap-1.5 mt-1.5 text-2xs text-muted-foreground tnum">
                        <Download className="w-3 h-3" />
                        Exported as <span className="font-mono text-foreground">{e.exportedAs}</span>
                        {e.exportedAt && <span>· {formatRelativeTime(e.exportedAt)}</span>}
                      </div>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => {
                    removeEntry(e.id)
                    toast.success('Removed from history')
                  }}
                  aria-label={`Remove ${e.filename} from history`}
                  className="icon-btn-sm flex-shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </motion.div>
          )
        })}
      </div>

      {entries.length > 0 && (
        <p className="text-2xs text-muted-foreground text-center">
          History is shared across your organisation — everyone with access sees the same list.
        </p>
      )}
    </div>
  )
}
