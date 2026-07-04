'use client'

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useAutoRefresh } from '@/hooks/useAutoRefresh'
import { motion } from 'framer-motion'
import {
  CheckCircle2, XCircle, Clock, Search, FileText, Download,
  ChevronRight, ArrowLeft, Edit2, AlertTriangle, RefreshCw, Send,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn, formatRelativeTime } from '@/utils/helpers'
import { useSessionStore } from '@/stores/sessionStore'
import {
  listSubmissions, getSubmission, approveSubmission, sendBackSubmission, downloadAnsweredSheet,
  type ReviewSubmission, type ReviewItem, type ItemDecisionPayload,
} from '@/services/api'

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pending:   { label: 'Pending',   color: 'text-amber-600 dark:text-amber-400',   bg: 'bg-amber-50 dark:bg-amber-950/40' },
  approved:  { label: 'Approved',  color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/40' },
  sent_back: { label: 'Sent back', color: 'text-red-600 dark:text-red-400',       bg: 'bg-red-50 dark:bg-red-950/40' },
}

const FLAG_CONFIG: Record<string, { label: string; color: string }> = {
  corrected: { label: 'Corrected', color: 'text-violet-600 dark:text-violet-400' },
  flagged:   { label: 'Flagged',   color: 'text-amber-600 dark:text-amber-400' },
  accepted:  { label: 'Accepted',  color: 'text-emerald-600 dark:text-emerald-400' },
  untouched: { label: '',          color: 'text-zinc-400' },
}


// Group submissions by lineage (follow previous_submission_id); the reviewer's
// active queue shows only the LATEST cycle of each chain. Older cycles are
// history. Returns latest submissions + a map from submission id -> its
// immediate predecessor (for prior-cycle context in the detail view).
function latestPerLineage(subs: ReviewSubmission[]): {
  latest: ReviewSubmission[]
  prevOf: Record<string, string>
} {
  const referenced = new Set(
    subs.map((s) => s.previous_submission_id).filter(Boolean) as string[]
  )
  const latest = subs.filter((s) => !referenced.has(s.id))
  const prevOf: Record<string, string> = {}
  for (const s of subs) {
    if (s.previous_submission_id) prevOf[s.id] = s.previous_submission_id
  }
  return { latest, prevOf }
}

export default function ReviewQueuePage() {
  const [mounted, setMounted] = useState(false)
  const [submissions, setSubmissions] = useState<ReviewSubmission[]>([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const canApprove = useSessionStore((s) => s.can('approve'))

  useEffect(() => { setMounted(true) }, [])

  // firstLoad gates the spinner + error toast to the initial mount only.
  // Background refreshes (focus / interval) swap data in place silently.
  const firstLoad = useRef(true)
  const refresh = useCallback(async () => {
    try {
      setSubmissions(await listSubmissions())
    } catch {
      if (firstLoad.current) toast.error('Could not load submissions')
    } finally {
      firstLoad.current = false
      setLoading(false)
    }
  }, [])

  useAutoRefresh(refresh, { enabled: mounted })

  const stats = useMemo(() => ({
    pending:  submissions.filter(s => s.status === 'pending').length,
    approved: submissions.filter(s => s.status === 'approved').length,
    sentBack: submissions.filter(s => s.status === 'sent_back').length,
  }), [submissions])

  const filtered = useMemo(() => {
    const { latest } = latestPerLineage(submissions)
    if (!search.trim()) return latest
    const q = search.toLowerCase()
    return latest.filter(s =>
      s.sheet_name.toLowerCase().includes(q) ||
      (s.display_name?.toLowerCase().includes(q) ?? false) ||
      s.submitted_by.toLowerCase().includes(q))
  }, [submissions, search])

  if (!mounted) return null

  if (openId) {
    return <SubmissionDetail
      id={openId}
      canApprove={canApprove}
      onBack={() => { setOpenId(null); refresh() }}
    />
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Review Queue</h1>
        <button onClick={refresh}
          className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>
      <p className="text-sm text-zinc-500 mb-6">
        {stats.pending} pending · {stats.approved} approved · {stats.sentBack} sent back
      </p>

      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by sheet or submitter…"
          className="w-full pl-9 pr-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
        />
      </div>

      {loading ? (
        <div className="text-center py-16 text-zinc-400 text-sm">Loading submissions…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-zinc-400 text-sm">
          No submissions yet. Sheets sent for review will appear here.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((sub) => {
            const st = STATUS_CONFIG[sub.status] ?? STATUS_CONFIG.pending
            return (
              <motion.button
                key={sub.id}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={() => setOpenId(sub.id)}
                className="w-full text-left rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 hover:border-indigo-300 dark:hover:border-indigo-700 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="w-4 h-4 text-zinc-400 shrink-0" />
                    <span className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                      {sub.display_name || sub.sheet_name}
                    </span>
                    <span className={cn('text-xs px-1.5 py-0.5 rounded-md font-medium', st.bg, st.color)}>
                      {st.label}
                    </span>
                    {(sub.cycle ?? 1) > 1 && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded-md font-medium bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400">
                        Resubmission · cycle {sub.cycle}
                      </span>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
                </div>
                <div className="mt-2 flex items-center gap-3 text-xs text-zinc-500">
                  <span>by {sub.submitted_by}</span>
                  {sub.submitted_at && <span>{formatRelativeTime(sub.submitted_at)}</span>}
                  <span className="text-zinc-300 dark:text-zinc-700">·</span>
                  <span>{sub.counts.total} questions</span>
                  {sub.counts.corrected > 0 && <span className="text-violet-600 dark:text-violet-400">{sub.counts.corrected} corrected</span>}
                  {sub.counts.flagged > 0 && <span className="text-amber-600 dark:text-amber-400">{sub.counts.flagged} flagged</span>}
                </div>
              </motion.button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Detail / review panel ─────────────────────────────────────────────────────

function SubmissionDetail({ id, canApprove, onBack }: {
  id: string
  canApprove: boolean
  onBack: () => void
}) {
  const [sub, setSub] = useState<ReviewSubmission | null>(null)
  const [prev, setPrev] = useState<ReviewSubmission | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  // per-item local edits & decisions for the send-back flow
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [comments, setComments] = useState<Record<string, string>>({})
  const [rejected, setRejected] = useState<Set<string>>(new Set())

  useEffect(() => {
    (async () => {
      try {
        const s = await getSubmission(id)
        setSub(s)
        // If this is a resubmission, fetch the prior cycle for context.
        if (s.previous_submission_id) {
          try { setPrev(await getSubmission(s.previous_submission_id)) }
          catch { /* prior cycle context is best-effort */ }
        }
      } catch {
        toast.error('Could not load submission')
      } finally {
        setLoading(false)
      }
    })()
  }, [id])

  const toggleReject = (qid: string) => {
    setRejected(prev => {
      const next = new Set(prev)
      next.has(qid) ? next.delete(qid) : next.add(qid)
      return next
    })
  }

  const handleApprove = async () => {
    // Collect reviewer edits so the KB and export reflect the reviewer's
    // improvements, not just what the submitter sent. Any item whose
    // edited answer differs from what's stored gets sent through. The
    // button is only rendered when no items are rejected (see gate
    // below), so we can safely walk all items without excluding rejects.
    const editsPayload: Record<string, string> = {}
    for (const item of sub?.items ?? []) {
      const qid = item.question_id
      const original = (item.corrected_answer || item.answer || '').trim()
      const edited = (edits[qid] ?? '').trim()
      if (edited && edited !== original) {
        editsPayload[qid] = edited
      }
    }
    setBusy(true)
    try {
      const res = await approveSubmission(id, { edits: editsPayload })
      toast.success(`Approved — ${res.ingested} correction(s) added to knowledge base`)
      onBack()
    } catch {
      toast.error('Approve failed')
    } finally {
      setBusy(false)
    }
  }

  const handleSendBack = async () => {
    if (rejected.size === 0) {
      toast.error('Reject at least one answer to send back')
      return
    }
    // A rejected item needs EITHER a genuine edit (answer changed) OR a comment.
    // The answer field is pre-filled, so "changed" means it differs from the
    // original; an unchanged pre-fill does not count as a correction.
    const decisions: ItemDecisionPayload[] = []
    for (const qid of rejected) {
      const item = sub?.items.find((i) => i.question_id === qid)
      const original = item?.corrected_answer || item?.answer || ''
      const edited = (edits[qid] ?? original).trim()
      const comment = comments[qid]?.trim()
      const changed = edited.length > 0 && edited !== original.trim()
      if (!changed && !comment) {
        toast.error('Each rejected answer needs an edit or a comment')
        return
      }
      decisions.push({
        question_id: qid,
        decision: 'rejected',
        corrected_answer: changed ? edited : undefined,
        comment,
      })
    }
    setBusy(true)
    try {
      await sendBackSubmission(id, { decisions })
      toast.success('Sent back to submitter')
      onBack()
    } catch {
      toast.error('Send-back failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="max-w-4xl mx-auto px-6 py-8 text-zinc-400 text-sm">Loading…</div>
  if (!sub) return <div className="max-w-4xl mx-auto px-6 py-8 text-zinc-400 text-sm">Not found.</div>

  const isPending = sub.status === 'pending'
  const st = STATUS_CONFIG[sub.status] ?? STATUS_CONFIG.pending

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back to queue
      </button>

      <div className="flex items-center gap-2 mb-1">
        <FileText className="w-5 h-5 text-zinc-400" />
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{sub.display_name || sub.sheet_name}</h1>
        <span className={cn('text-xs px-1.5 py-0.5 rounded-md font-medium', st.bg, st.color)}>{st.label}</span>
      </div>
      <p className="text-sm text-zinc-500 mb-6">
        Submitted by {sub.submitted_by}
        {sub.submitted_at && ` · ${formatRelativeTime(sub.submitted_at)}`}
        {' · '}{sub.counts.total} questions
      </p>

      {/* Prior-cycle context: a light one-line resubmission indicator */}
      {prev && (sub.cycle ?? 1) > 1 && (
        <div className="flex items-center gap-1.5 text-xs text-indigo-600 dark:text-indigo-400 mb-4">
          <RefreshCw className="w-3.5 h-3.5" />
          Resubmission (cycle {sub.cycle}) — you flagged {prev.items.filter((i) => i.decision === 'rejected').length} answer(s) last cycle
        </div>
      )}

      <div className="space-y-3">
        {sub.items.map((it) => (
          <ReviewItemCard
            key={it.question_id}
            item={it}
            editable={isPending && canApprove}
            rejected={rejected.has(it.question_id)}
            editValue={edits[it.question_id] ?? (it.corrected_answer || it.answer)}
            commentValue={comments[it.question_id] ?? ''}
            onToggleReject={() => toggleReject(it.question_id)}
            onEdit={(v) => setEdits(p => ({ ...p, [it.question_id]: v }))}
            onComment={(v) => setComments(p => ({ ...p, [it.question_id]: v }))}
          />
        ))}
      </div>

      {isPending && canApprove && (
        <div className="sticky bottom-0 mt-6 -mx-6 px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-zinc-950/90 backdrop-blur flex items-center justify-between">
          <span className="text-xs text-zinc-500">
            {rejected.size > 0
              ? `${rejected.size} answer(s) marked to send back`
              : 'Approve the sheet, or reject answers to send back'}
          </span>
          <div className="flex items-center gap-2">
            {rejected.size > 0 ? (
              <button onClick={handleSendBack} disabled={busy}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-50">
                <Send className="w-4 h-4" /> Send back ({rejected.size})
              </button>
            ) : (
              <button onClick={handleApprove} disabled={busy}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-50">
                <CheckCircle2 className="w-4 h-4" /> Approve sheet
              </button>
            )}
          </div>
        </div>
      )}

      {/* Phase 5: approved submissions get a Download answered sheet action */}
      {sub.status === 'approved' && (
        <div className="sticky bottom-0 mt-6 -mx-6 px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-zinc-950/90 backdrop-blur flex items-center justify-between">
          <span className="text-xs text-zinc-500">
            Original layout preserved. Only the answer columns are filled.
          </span>
          <button
            onClick={async () => {
              try {
                await downloadAnsweredSheet(sub.id, sub.display_name || sub.sheet_name)
              } catch (e: any) {
                toast.error(e?.message || 'Download failed')
              }
            }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium">
            <Download className="w-4 h-4" /> Download answered sheet
          </button>
        </div>
      )}
    </div>
  )
}

function ReviewItemCard({ item, editable, rejected, editValue, commentValue, onToggleReject, onEdit, onComment }: {
  item: ReviewItem
  editable: boolean
  rejected: boolean
  editValue: string
  commentValue: string
  onToggleReject: () => void
  onEdit: (v: string) => void
  onComment: (v: string) => void
}) {
  const flag = FLAG_CONFIG[item.flag_type] ?? FLAG_CONFIG.untouched
  const isTouched = item.flag_type === 'corrected' || item.flag_type === 'flagged'
  const isAccepted = item.flag_type === 'accepted'

  return (
    <div className={cn(
      'rounded-xl border p-4',
      rejected ? 'border-red-300 dark:border-red-800 bg-red-50/40 dark:bg-red-950/20'
        : isTouched ? 'border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900'
        : 'border-zinc-100 dark:border-zinc-800/50 bg-zinc-50/50 dark:bg-zinc-900/40',
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {flag.label && (
            <span className={cn('text-[11px] font-medium uppercase tracking-wide', flag.color)}>
              {flag.label}
            </span>
          )}
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100 mt-0.5">{item.question}</p>
        </div>
        {editable && isTouched && (
          <button onClick={onToggleReject}
            className={cn('shrink-0 text-xs px-2 py-1 rounded-md border',
              rejected ? 'border-red-400 text-red-600 dark:text-red-400'
                : 'border-zinc-200 dark:border-zinc-700 text-zinc-500 hover:border-red-300')}>
            {rejected ? 'Rejecting' : 'Reject'}
          </button>
        )}
      </div>

      {rejected ? (
        <div className="mt-3 space-y-2">
          <label className="text-xs font-medium text-zinc-500">Edit the answer, or leave it and add a comment</label>
          <textarea
            value={editValue}
            onChange={(e) => onEdit(e.target.value)}
            rows={4}
            className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/20 whitespace-pre-wrap"
          />
          <input
            value={commentValue}
            onChange={(e) => onComment(e.target.value)}
            placeholder="Comment to the submitter…"
            className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/20"
          />
        </div>
      ) : (
        <p className={cn('text-sm mt-2 whitespace-pre-wrap',
          isAccepted ? 'text-zinc-400 dark:text-zinc-500' : 'text-zinc-700 dark:text-zinc-300')}>
          {item.corrected_answer || item.answer}
        </p>
      )}
    </div>
  )
}