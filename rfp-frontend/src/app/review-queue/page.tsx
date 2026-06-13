'use client'

import { useState, useMemo, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  CheckCircle2, XCircle, AlertTriangle, Clock,
  Search, Filter, BarChart3, ChevronDown, ChevronUp,
  MessageSquare, RefreshCw, Edit2, Check, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn, availabilityConfig, formatRelativeTime } from '@/utils/helpers'
import { useReviewStore } from '@/stores/reviewStore'
import { useSessionStore } from '@/stores/sessionStore'
import type { GeneratedResponse, ResponseStatus } from '@/types'

const STATUS_CONFIG: Record<string, { label: string; icon: typeof CheckCircle2; color: string; bg: string }> = {
  needs_review: { label: 'Needs Review', icon: Clock, color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/40' },
  approved:     { label: 'Approved',     icon: CheckCircle2, color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/40' },
  rejected:     { label: 'Rejected',     icon: XCircle, color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-950/40' },
  generated:    { label: 'Generated',    icon: CheckCircle2, color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-950/40' },
  edited:       { label: 'Edited',       icon: Edit2, color: 'text-violet-600 dark:text-violet-400', bg: 'bg-violet-50 dark:bg-violet-950/40' },
}

type FilterType = 'all' | ResponseStatus | 'low_confidence'

export default function ReviewQueuePage() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const { responses, approve, reject, addComment } = useReviewStore()
  const canApprove = useSessionStore((s) => s.can('approve'))
  const stats = { needsReview: responses.filter(r => r.status === 'needs_review').length, approved: responses.filter(r => r.status === 'approved').length, rejected: responses.filter(r => r.status === 'rejected').length, lowConfidence: responses.filter(r => (r.confidence?.score ?? 0) < 0.7).length }

  const [filter, setFilter] = useState<FilterType>('all')
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [commentText, setCommentText] = useState('')
  const [commentingId, setCommentingId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const filtered = useMemo(() => {
    let rs = responses
    if (filter === 'low_confidence') rs = rs.filter((r) => r.confidence?.score < 0.7)
    else if (filter !== 'all') rs = rs.filter((r) => r.status === filter)
    if (search) {
      const q = search.toLowerCase()
      rs = rs.filter((r) => r.question.toLowerCase().includes(q) || r.section.toLowerCase().includes(q))
    }
    return rs
  }, [responses, filter, search])

  function toggleSelect(id: string) {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  function bulkApprove() {
    // approve() handles feedback capture, KB ingestion, and the
    // wizard mirror internally — single source of review side-effects.
    selected.forEach((id) => approve(id))
    toast.success(`${selected.size} responses approved`)
    setSelected(new Set())
  }

  function bulkReject() {
    selected.forEach((id) => reject(id))
    toast.success(`${selected.size} responses rejected`)
    setSelected(new Set())
  }

  function submitComment(id: string) {
    if (!commentText.trim()) return
    addComment(id, commentText.trim())
    setCommentText('')
    setCommentingId(null)
    toast.success('Comment added')
  }

  if (!mounted) return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        Loading...
      </div>
    </div>
  )

  if (responses.length === 0) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <h1 className="text-2xl font-semibold tracking-tight mb-1">Review Queue</h1>
        <p className="text-sm text-muted-foreground mb-8">No responses to review yet. Generate answers in Workspace first.</p>
        <div className="bg-card border border-border rounded-xl p-12 text-center">
          <AlertTriangle className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">Queue is empty</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Review Queue</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {stats.needsReview} pending · {stats.approved} approved · {stats.rejected} rejected
          </p>
        </div>
        {selected.size > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{selected.size} selected</span>
            <button onClick={bulkApprove}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 text-sm font-medium hover:bg-emerald-500/20 transition-colors">
              <Check className="w-3.5 h-3.5" /> Approve all
            </button>
            <button onClick={bulkReject}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/10 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 text-sm font-medium hover:bg-red-500/20 transition-colors">
              <X className="w-3.5 h-3.5" /> Reject all
            </button>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Needs Review', value: stats.needsReview, color: 'text-amber-500', onClick: () => setFilter('needs_review') },
          { label: 'Approved', value: stats.approved, color: 'text-emerald-500', onClick: () => setFilter('approved') },
          { label: 'Rejected', value: stats.rejected, color: 'text-red-500', onClick: () => setFilter('rejected') },
          { label: 'Low Confidence', value: stats.lowConfidence, color: 'text-orange-500', onClick: () => setFilter('low_confidence') },
        ].map(({ label, value, color, onClick }) => (
          <button key={label} onClick={onClick}
            className={cn('bg-card border border-border rounded-xl p-4 text-left hover:border-primary/30 transition-colors',
              filter === label.toLowerCase().replace(' ', '_') && 'border-primary/40')}>
            <div className={cn('text-2xl font-bold font-mono mb-1', color)}>{value}</div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search questions..."
            className="w-full pl-9 pr-4 py-2 text-sm bg-muted/40 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all" />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {(['all', 'needs_review', 'approved', 'rejected', 'low_confidence'] as FilterType[]).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={cn('px-3 py-1.5 rounded-lg text-xs font-medium transition-all border',
                filter === f ? 'bg-primary/10 text-primary border-primary/30' : 'text-muted-foreground border-transparent hover:border-border')}>
              {f.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
            </button>
          ))}
        </div>
      </div>

      {/* Response list */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="bg-card border border-border rounded-xl p-8 text-center text-sm text-muted-foreground">
            {responses.length === 0
              ? 'No responses yet — generate answers in Workspace first.'
              : `No responses match "${filter.replace(/_/g, ' ')}" filter. Try "All" to see everything.`}
          </div>
        )}
        {filtered.map((r) => {
          const avail = availabilityConfig(r.availability)
          const isExpanded = expandedId === r.id
          const isSelected = selected.has(r.id)
          const statusCfg = STATUS_CONFIG[r.status] ?? STATUS_CONFIG['generated']
          const StatusIcon = statusCfg.icon
          const confLabel = r.confidence?.label ?? 'low'

          return (
            <motion.div key={r.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className={cn('border rounded-xl overflow-hidden transition-all',
                isSelected ? 'border-primary/40 bg-primary/5' : 'border-border bg-card')}>
              <div className="flex items-start gap-3 p-4">
                <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(r.id)}
                  className="w-4 h-4 mt-0.5 rounded accent-primary flex-shrink-0" />

                <div className={cn('w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0', avail.dot)} />

                <div className="flex-1 min-w-0">
                  {r.section && <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">{r.section}</p>}
                  <p className="text-sm font-medium text-foreground mb-1.5 line-clamp-2">{r.question}</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn('flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded', statusCfg.color, statusCfg.bg)}>
                      <StatusIcon className="w-3 h-3" />{statusCfg.label}
                    </span>
                    <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded border',
                      avail.color, avail.bg, avail.border)}>{r.availability}</span>
                    <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border',
                      confLabel === 'high' ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400' :
                      confLabel === 'medium' ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400' :
                      'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400')}>
                      <BarChart3 className="w-2.5 h-2.5" />{Math.round((r.confidence?.score ?? 0) * 100)}%
                    </span>
                    {(r.comments?.length ?? 0) > 0 && (
                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <MessageSquare className="w-3 h-3" />{r.comments.length}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {canApprove && r.status !== 'approved' && (
                    <button onClick={() => approve(r.id)}
                      className="p-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 hover:opacity-80 transition-opacity" title="Approve">
                      <CheckCircle2 className="w-4 h-4" />
                    </button>
                  )}
                  {r.status !== 'rejected' && (
                    <button onClick={() => reject(r.id)}
                      className="p-1.5 rounded-lg bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 hover:opacity-80 transition-opacity" title="Reject">
                      <XCircle className="w-4 h-4" />
                    </button>
                  )}
                  <button onClick={() => setExpandedId(isExpanded ? null : r.id)}
                    className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {isExpanded && (
                <div className="px-4 pb-4 border-t border-border/50 pt-3 space-y-4">
                  <p className="text-sm text-foreground leading-relaxed">{r.editedRemarks ?? r.remarks}</p>

                  {/* Sources */}
                  {r.sources?.length > 0 && (
                    <div className="flex gap-1.5 flex-wrap">
                      {r.sources.map((s) => (
                        <span key={s} className="text-[10px] font-mono bg-muted text-muted-foreground px-2 py-0.5 rounded">{s}</span>
                      ))}
                    </div>
                  )}

                  {/* Audit log */}
                  {r.auditLog?.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Audit trail</p>
                      <div className="space-y-1">
                        {r.auditLog.slice(-5).map((e) => (
                          <div key={e.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="font-mono">{new Date(e.timestamp).toLocaleTimeString()}</span>
                            <span className="capitalize">{e.type}</span>
                            <span>by {e.actor}</span>
                            {e.note && <span className="text-muted-foreground/60">— {e.note.slice(0, 60)}</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Comments */}
                  {(r.comments?.length ?? 0) > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Comments</p>
                      <div className="space-y-2">
                        {r.comments.map((c) => (
                          <div key={c.id} className="bg-muted/40 rounded-lg px-3 py-2">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-medium text-foreground">{c.author}</span>
                              <span className="text-[10px] text-muted-foreground">{formatRelativeTime(c.createdAt)}</span>
                            </div>
                            <p className="text-xs text-muted-foreground">{c.text}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Add comment */}
                  {commentingId === r.id ? (
                    <div className="flex gap-2">
                      <input value={commentText} onChange={(e) => setCommentText(e.target.value)}
                        placeholder="Add a review comment..."
                        className="flex-1 px-3 py-2 text-sm bg-muted/40 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all"
                        onKeyDown={(e) => { if (e.key === 'Enter') submitComment(r.id) }} />
                      <button onClick={() => submitComment(r.id)}
                        className="px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium">Save</button>
                      <button onClick={() => setCommentingId(null)}
                        className="px-3 py-2 rounded-lg border border-border text-xs text-muted-foreground">Cancel</button>
                    </div>
                  ) : (
                    <button onClick={() => setCommentingId(r.id)}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                      <MessageSquare className="w-3.5 h-3.5" /> Add comment
                    </button>
                  )}
                </div>
              )}
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}