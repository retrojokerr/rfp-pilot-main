'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion } from 'framer-motion'
import {
  FileText, Clock, CheckCircle2, RotateCcw, ChevronRight, ArrowLeft,
  RefreshCw, Download, MessageSquare, Edit3, Send,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn, formatRelativeTime } from '@/utils/helpers'
import {
  listSubmissions, getSubmission, createSubmission,
  type ReviewSubmission, type ReviewItem, type ReviewItemPayload,
} from '@/services/api'

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: typeof Clock }> = {
  pending:   { label: 'In review', color: 'text-amber-600 dark:text-amber-400',   bg: 'bg-amber-50 dark:bg-amber-950/40',   icon: Clock },
  approved:  { label: 'Approved',  color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/40', icon: CheckCircle2 },
  sent_back: { label: 'Sent back', color: 'text-red-600 dark:text-red-400',       bg: 'bg-red-50 dark:bg-red-950/40',       icon: RotateCcw },
}


// Group submissions into sheet-lineage chains by following previous_submission_id.
// Each chain = one sheet's journey; cycles sorted newest-first within.
interface Lineage {
  key: string
  sheetName: string
  current: ReviewSubmission      // newest cycle
  history: ReviewSubmission[]    // older cycles, newest-first
}

function buildLineages(subs: ReviewSubmission[]): Lineage[] {
  const byId = new Map(subs.map((s) => [s.id, s]))
  // A submission is a "head" (latest) if no other submission points back to it.
  const referenced = new Set(
    subs.map((s) => s.previous_submission_id).filter(Boolean) as string[]
  )
  const heads = subs.filter((s) => !referenced.has(s.id))

  const lineages: Lineage[] = heads.map((head) => {
    // Walk backwards through previous_submission_id to collect the chain.
    const chain: ReviewSubmission[] = [head]
    let cur = head
    while (cur.previous_submission_id && byId.has(cur.previous_submission_id)) {
      cur = byId.get(cur.previous_submission_id)!
      chain.push(cur)
    }
    return {
      key: head.id,
      sheetName: head.sheet_name,
      current: chain[0],
      history: chain.slice(1),
    }
  })

  // Sort lineages by the current cycle's submitted_at, newest first.
  lineages.sort((a, b) =>
    (b.current.submitted_at ?? '').localeCompare(a.current.submitted_at ?? ''))
  return lineages
}

export default function MySubmissionsPage() {
  const [mounted, setMounted] = useState(false)
  const [submissions, setSubmissions] = useState<ReviewSubmission[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<{ id: string; readOnly: boolean } | null>(null)

  useEffect(() => { setMounted(true) }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      // listSubmissions returns only the caller's own when they aren't a reviewer;
      // reviewers see all, so we also filter client-side by nothing here — the
      // page is "my submissions", backend already scopes for non-reviewers.
      setSubmissions(await listSubmissions())
    } catch {
      toast.error('Could not load your submissions')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (mounted) refresh() }, [mounted, refresh])

  if (!mounted) return null

  if (open) {
    return <MySubmissionDetail id={open.id} readOnly={open.readOnly} onBack={() => { setOpen(null); refresh() }} />
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">My Submissions</h1>
        <button onClick={refresh}
          className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>
      <p className="text-sm text-zinc-500 mb-6">Track sheets you've sent for review.</p>

      {loading ? (
        <div className="text-center py-16 text-zinc-400 text-sm">Loading…</div>
      ) : submissions.length === 0 ? (
        <div className="text-center py-16 text-zinc-400 text-sm">
          You haven't sent any sheets for review yet.
        </div>
      ) : (
        <div className="space-y-3">
          {buildLineages(submissions).map((lin) => (
            <LineageCard key={lin.key} lineage={lin} onOpen={(id, readOnly) => setOpen({ id, readOnly })} />
          ))}
        </div>
      )}
    </div>
  )
}


// A single sheet's card: headline = current cycle status; a thread of cycles below.
function LineageCard({ lineage, onOpen }: { lineage: Lineage; onOpen: (id: string, readOnly: boolean) => void }) {
  const { current, history, sheetName } = lineage
  const st = STATUS_CONFIG[current.status] ?? STATUS_CONFIG.pending
  const Icon = st.icon
  const hasHistory = history.length > 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-hidden"
    >
      {/* Headline: sheet + current status, opens the current cycle */}
      <button
        onClick={() => onOpen(current.id, false)}
        className="w-full text-left p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/40 transition-colors"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="w-4 h-4 text-zinc-400 shrink-0" />
            <span className="font-medium text-zinc-900 dark:text-zinc-100 truncate">{sheetName}</span>
            <span className={cn('text-xs px-1.5 py-0.5 rounded-md font-medium inline-flex items-center gap-1', st.bg, st.color)}>
              <Icon className="w-3 h-3" /> {st.label}
            </span>
          </div>
          <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
        </div>
        <div className="mt-2 flex items-center gap-3 text-xs text-zinc-500">
          {current.submitted_at && <span>{formatRelativeTime(current.submitted_at)}</span>}
          <span className="text-zinc-300 dark:text-zinc-700">·</span>
          <span>{current.counts.total} questions</span>
          {current.status === 'sent_back' && (
            <span className="text-red-600 dark:text-red-400">needs changes</span>
          )}
        </div>
      </button>

      {/* Cycle thread — shown only when there's history (a resubmission chain) */}
      {hasHistory && (
        <div className="border-t border-zinc-100 dark:border-zinc-800/60 px-4 py-3 bg-zinc-50/50 dark:bg-zinc-950/30">
          <div className="space-y-1.5">
            {/* current cycle marker */}
            <CycleRow sub={current} isCurrent onOpen={(id) => onOpen(id, false)} />
            {history.map((h) => (
              <CycleRow key={h.id} sub={h} onOpen={(id) => onOpen(id, true)} />
            ))}
          </div>
        </div>
      )}
    </motion.div>
  )
}

function CycleRow({ sub, isCurrent, onOpen }: { sub: ReviewSubmission; isCurrent?: boolean; onOpen: (id: string) => void }) {
  const st = STATUS_CONFIG[sub.status] ?? STATUS_CONFIG.pending
  return (
    <button
      onClick={() => onOpen(sub.id)}
      className={cn(
        'w-full flex items-center gap-2 text-xs rounded-md px-2 py-1 -mx-2 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800/60',
        isCurrent ? 'text-zinc-700 dark:text-zinc-200' : 'text-zinc-400 dark:text-zinc-500'
      )}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', isCurrent ? 'bg-indigo-500' : 'bg-zinc-300 dark:bg-zinc-600')} />
      <span className="font-medium">Cycle {sub.cycle ?? 1}</span>
      <span className={cn('px-1 rounded', st.color)}>{st.label}</span>
      {sub.submitted_at && <span className="ml-auto">{formatRelativeTime(sub.submitted_at)}</span>}
    </button>
  )
}

// ── Detail ────────────────────────────────────────────────────────────────────

function MySubmissionDetail({ id, readOnly = false, onBack }: { id: string; readOnly?: boolean; onBack: () => void }) {
  const [sub, setSub] = useState<ReviewSubmission | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [fixes, setFixes] = useState<Record<string, string>>({})

  useEffect(() => {
    (async () => {
      try { setSub(await getSubmission(id)) }
      catch { toast.error('Could not load submission') }
      finally { setLoading(false) }
    })()
  }, [id])

  if (loading) return <div className="max-w-4xl mx-auto px-6 py-8 text-zinc-400 text-sm">Loading…</div>
  if (!sub) return <div className="max-w-4xl mx-auto px-6 py-8 text-zinc-400 text-sm">Not found.</div>

  const st = STATUS_CONFIG[sub.status] ?? STATUS_CONFIG.pending
  const isSentBack = sub.status === 'sent_back'
  const isApproved = sub.status === 'approved'
  // On a sent-back sheet the submitter only needs to act on rejected items.
  const rejectedItems = sub.items.filter((i) => i.decision === 'rejected')

  const handleResubmit = async () => {
    // Build a fresh submission from the sheet, applying the submitter's fixes to
    // the rejected items (which become 'corrected'); everything else carries over.
    const items: ReviewItemPayload[] = sub.items.map((it) => {
      const fix = fixes[it.question_id]?.trim()
      const wasRejected = it.decision === 'rejected'
      const newAnswer = wasRejected && fix ? fix : (it.corrected_answer || it.answer)
      return {
        question_id: it.question_id,
        question: it.question,
        section: it.section ?? '',
        answer: newAnswer,
        original_answer: it.original_answer ?? it.answer,
        corrected_answer: wasRejected ? newAnswer : it.corrected_answer ?? undefined,
        flag_type: wasRejected ? 'corrected' : it.flag_type,
        confidence: it.confidence ?? undefined,
        availability: it.availability ?? undefined,
      }
    })
    // Require a fix for each rejected item that had no reviewer-supplied correction.
    for (const it of rejectedItems) {
      const fix = fixes[it.question_id]?.trim()
      if (!fix && !it.corrected_answer) {
        toast.error('Please address each rejected answer before resubmitting')
        return
      }
    }
    setBusy(true)
    try {
      await createSubmission({
        doc_id: sub.doc_id,
        sheet_name: sub.sheet_name,
        items,
        previous_submission_id: sub.id,
      })
      toast.success('Resubmitted for review')
      onBack()
    } catch {
      toast.error('Could not resubmit')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 mb-4">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <div className="flex items-center gap-2 mb-1">
        <FileText className="w-5 h-5 text-zinc-400" />
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{sub.sheet_name}</h1>
        <span className={cn('text-xs px-1.5 py-0.5 rounded-md font-medium', st.bg, st.color)}>{st.label}</span>
      </div>
      <p className="text-sm text-zinc-500 mb-6">
        {sub.submitted_at && formatRelativeTime(sub.submitted_at)}
        {sub.reviewed_by && ` · reviewed by ${sub.reviewed_by}`}
        {(sub.cycle ?? 1) > 1 && ` · cycle ${sub.cycle}`}
      </p>

      {/* Approved: success + export */}
      {isApproved && (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/20 p-4 mb-6">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 text-sm font-medium">
            <CheckCircle2 className="w-4 h-4" /> Approved — corrections added to the knowledge base
          </div>
          <p className="text-xs text-zinc-500 mt-1">Faithful export (original layout preserved) is coming soon.</p>
        </div>
      )}

      {/* Superseded historical cycle: read-only banner */}
      {isSentBack && readOnly && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-900/40 p-4 mb-4 text-sm text-zinc-500">
          This is a previous review cycle (already resubmitted). Shown for history — no changes can be made here.
        </div>
      )}

      {/* Sent back (latest cycle): editable items with reviewer feedback */}
      {isSentBack && !readOnly && (
        <>
          {sub.reviewer_comment && (
            <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 mb-4">
              <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 mb-1">
                <MessageSquare className="w-3.5 h-3.5" /> Reviewer note
              </div>
              <p className="text-sm text-zinc-700 dark:text-zinc-300">{sub.reviewer_comment}</p>
            </div>
          )}
          <p className="text-sm text-zinc-500 mb-3">
            {rejectedItems.length} answer(s) need changes:
          </p>
          <div className="space-y-3">
            {rejectedItems.map((it) => (
              <div key={it.question_id} className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50/40 dark:bg-red-950/20 p-4">
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{it.question}</p>
                <p className="text-sm text-zinc-500 mt-1.5 whitespace-pre-wrap">{it.answer}</p>

                {it.comment && (
                  <div className="mt-2 flex items-start gap-1.5 text-xs text-red-700 dark:text-red-400">
                    <MessageSquare className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>{it.comment}</span>
                  </div>
                )}
                {it.corrected_answer && it.corrected_answer !== it.answer && (
                  <div className="mt-2 text-xs text-zinc-500">
                    <span className="font-medium">Reviewer's suggested answer:</span>
                    <p className="mt-0.5 text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">{it.corrected_answer}</p>
                  </div>
                )}

                <div className="mt-3">
                  <label className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 mb-1">
                    <Edit3 className="w-3.5 h-3.5" /> Your revised answer
                  </label>
                  <textarea
                    value={fixes[it.question_id] ?? (it.corrected_answer && it.corrected_answer !== it.answer ? it.corrected_answer : it.answer)}
                    onChange={(e) => setFixes((p) => ({ ...p, [it.question_id]: e.target.value }))}
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="sticky bottom-0 mt-6 -mx-6 px-6 py-4 border-t border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-zinc-950/90 backdrop-blur flex items-center justify-end">
            <button onClick={handleResubmit} disabled={busy}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium disabled:opacity-50">
              <Send className="w-4 h-4" /> {busy ? 'Resubmitting…' : 'Resubmit for review'}
            </button>
          </div>
        </>
      )}

      {/* Superseded historical cycle: show the rejected items read-only */}
      {isSentBack && readOnly && (
        <div className="space-y-3">
          {rejectedItems.map((it) => (
            <div key={it.question_id} className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{it.question}</p>
              <p className="text-sm text-zinc-500 mt-1.5 whitespace-pre-wrap">{it.answer}</p>
              {it.comment && (
                <div className="mt-2 flex items-start gap-1.5 text-xs text-red-600 dark:text-red-400">
                  <MessageSquare className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{it.comment}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pending: read-only status */}
      {sub.status === 'pending' && (
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4 text-sm text-zinc-500">
          This sheet is awaiting review. You'll be notified when it's approved or sent back.
        </div>
      )}
    </div>
  )
}
