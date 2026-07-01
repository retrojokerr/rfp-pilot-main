'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence, MotionConfig } from 'framer-motion'
import {
  AlertCircle, RefreshCw, Download, ChevronDown, ChevronUp,
  Edit2, Check, X, Sparkles, BarChart3, Upload, Square, Play, Send, ClipboardCheck, Flag,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn, availabilityConfig, confidenceBg, formatConfidence, isAnswered } from '@/utils/helpers'
import { Tooltip } from '@/components/ui/Tooltip'
import { useWizardStore } from '@/stores/wizardStore'
import { useHistoryStore } from '@/stores/historyStore'
import { useSessionStore } from '@/stores/sessionStore'
import { startGeneration, stopGeneration, resetGeneration } from '@/stores/generationEngine'
import { exportToOriginalWorkbook, exportSheetAsNewWorkbook } from '@/utils/exporter'
import { useReviewStore } from '@/stores/reviewStore'
import { useFeedbackStore } from '@/stores/feedbackStore'
import { generateAnswer, parseApiError, ingestCorrection, createSubmission, type ReviewItemPayload, type ReviewFlagType } from '@/services/api'
import type { GeneratedResponse, AvailabilityLabel } from '@/types'

const AVAIL_OPTIONS: AvailabilityLabel[] = ['Yes', 'No', 'Partial', 'Unknown']

export default function GenerateStep() {
  const {
    items, selectedIds, responses, upsertResponse,
    updateResponseStatus, updateResponseEdit, updateResponseAvailability,
    generationStatus,
  } = useWizardStore()

  // Capability gating (cosmetic — every API call is re-checked server-side)
  const can = useSessionStore((s) => s.can)
  const canGenerate = can('generate')
  const canCorrect = can('correct')

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  // Export dialog: which export mode is pending, and the user-editable name
  const [exportMode, setExportMode] = useState<'sheet' | 'full' | null>(null)
  const [exportName, setExportName] = useState('')
  const [editText, setEditText] = useState('')

  // ── Review decision per answer (Phase 2) ───────────────────
  // 'kb_direct' = correction ingests immediately (default for KB-direct edits)
  // 'review'    = correction staged, ingests only on reviewer approval
  // 'flag'      = no correction; sent for review as-is (locked)
  type Decision = 'kb_direct' | 'review' | 'flag'
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [submitting, setSubmitting] = useState(false)

  function setDecision(id: string, d: Decision) {
    setDecisions((prev) => ({ ...prev, [id]: d }))
  }

  // Items marked for the reviewer (corrected OR flagged) gate the submit button.
  const reviewMarkedIds = Object.entries(decisions)
    .filter(([, d]) => d === 'review' || d === 'flag')
    .map(([id]) => id)
  const hasReviewItems = reviewMarkedIds.length > 0

  async function handleSendForReview() {
    const wizard = useWizardStore.getState()
    const workbook = wizard.workbook
    if (!workbook) {
      toast.error('No workbook found. Please re-upload your file.')
      return
    }
    // Snapshot ALL answered responses in the current selection — including
    // untouched/KB-direct ones — so the reviewer sees the whole sheet and the
    // export can rebuild the original structure (section/subsection/sourceRow).
    const answered = currentResponses.filter((r) => isAnswered(r.status))
    if (answered.length === 0) {
      toast.error('Nothing to send — generate answers first.')
      return
    }
    const items: ReviewItemPayload[] = answered.map((r) => {
      const d = decisions[r.id] ?? 'kb_direct'
      const flag_type: ReviewFlagType =
        d === 'review' ? 'corrected' : d === 'flag' ? 'flagged' : 'accepted'
      const sourceItem = wizard.items.find((it) => it.id === r.id)
      return {
        question_id: r.id,
        question: r.question,
        section: r.section || sourceItem?.section || '',
        answer: r.editedRemarks ?? r.remarks,
        original_answer: r.remarks,
        corrected_answer: flag_type === 'corrected' ? (r.editedRemarks ?? r.remarks) : undefined,
        flag_type,
        confidence: r.confidence?.score,
        availability: r.availability,
      }
    })
    setSubmitting(true)
    try {
      const sub = await createSubmission({
        doc_id: wizard.currentRfiId || workbook.filename,
        sheet_name: workbook.filename,
        items,
      })
      toast.success('Sent for review', {
        description: `${sub.counts.corrected} corrected · ${sub.counts.flagged} flagged · ${sub.counts.accepted} accepted`,
      })
      setDecisions({})
    } catch (err) {
      toast.error('Could not send for review', { description: parseApiError(err) })
    } finally {
      setSubmitting(false)
    }
  }

  const selectedItems = items.filter((i) => selectedIds.has(i.id))
  const total = selectedItems.length

  // Only responses belonging to the current selection — leftovers from a
  // previous run never pollute the counts, stats, or progress bar.
  const currentResponses = responses.filter((r) => selectedIds.has(r.id))
  const done = currentResponses.filter((r) => isAnswered(r.status)).length
  const errors = currentResponses.filter((r) => r.status === 'error').length
  const remaining = total - done
  const allDone = done + errors === total && total > 0

  // Progress is DERIVED from store state, never from component-local state,
  // so it is always correct when you navigate away and come back mid-run.
  const progress = total > 0 ? Math.round(((done + errors) / total) * 100) : 0

  const isRunning = generationStatus === 'running'
  const isStopping = generationStatus === 'stopping'
  const isStopped = generationStatus === 'stopped'
  const canResume = !isRunning && !isStopping && remaining > 0 && total > 0

  // The engine is idempotent and module-scoped: if a run is already in
  // flight (e.g. the user navigated away and back), this is a no-op and
  // the UI simply re-attaches to live progress. It will NEVER restart
  // answers that are already generated.
  useEffect(() => {
    // Read-only/reviewer roles can view results but must not trigger
    // generation (the backend would 403 each call anyway).
    if (useSessionStore.getState().can('generate')) startGeneration()
  }, [])

  function handleNewRfi() {
    resetGeneration() // abort any in-flight run before clearing state
    const store = useWizardStore.getState()
    store.clearResponses()
    store.clearSelection()
    store.setStep('upload')
  }

  function startEdit(r: GeneratedResponse) {
    setEditingId(r.id)
    setEditText(r.editedRemarks ?? r.remarks)
    setExpandedId(r.id)
  }

  function saveEdit(id: string) {
    const updated = useWizardStore.getState().responses.find(r => r.id === id)
    updateResponseEdit(id, editText)
    const decision = decisions[id] ?? 'kb_direct'
    if (updated && editText !== updated.remarks) {
      // Editing an answer that is staged for review marks it 'corrected' but
      // DEFERS knowledge-base ingestion until a reviewer approves. Editing in
      // the KB-direct path ingests immediately (the original fast path).
      if (decision === 'review') {
        toast.success('Correction staged for review', {
          description: 'Will be added to the knowledge base when a reviewer approves.',
        })
        setEditingId(null)
        return
      }
      // KB-direct path: ingest immediately.
      useFeedbackStore.getState().capture({
        question: updated.question,
        section: updated.section,
        badAnswer: updated.remarks,
        goodAnswer: editText,
        availability: updated.availability,
        confidence: updated.confidence.score,
        signal: 'edited',
        source: 'workspace',
      })
      ingestCorrection({
        question: updated.question,
        good_answer: editText,
        section: updated.section,
        source: 'workspace',
      }).catch(() => {
        toast.error('Correction saved locally only', {
          description: 'Could not reach the backend to update the knowledge base.',
        })
      })
      toast.success('Answer updated', {
        description: 'Added to the knowledge base',
      })
    }
    setEditingId(null)
  }

  async function retryOne(item: GeneratedResponse) {
    updateResponseStatus(item.id, 'generating')
    try {
      const result = await generateAnswer({ question: item.question, section: item.section })
      const confidenceScore = result.confidence?.score ?? 0
      // Explicit field mapping (no blind spread) + the SAME needs_review
      // threshold the batch engine uses — previously a retried low-confidence
      // answer silently skipped review.
      const regenerated: GeneratedResponse = {
        ...item,
        availability: result.availability,
        remarks: result.remarks,
        sources: result.sources,
        confidence: result.confidence,
        editedRemarks: undefined,
        status: confidenceScore < 0.7 ? 'needs_review' : 'generated',
        generatedAt: new Date().toISOString(),
        comments: item.comments ?? [],
        versions: item.versions ?? [],
        auditLog: [
          ...(item.auditLog ?? []),
          { id: Math.random().toString(36).slice(2), type: 'regenerated' as const, actor: 'Reviewer', timestamp: new Date().toISOString() },
        ],
      }
      upsertResponse(regenerated)
      useReviewStore.getState().upsertResponse(regenerated)
      toast.success('Regenerated successfully')
    } catch (err) {
      updateResponseStatus(item.id, 'error')
      toast.error('Retry failed', { description: parseApiError(err) })
    }
  }

  function getExportableResponses() {
    return responses.filter((r) => isAnswered(r.status))
  }

  // Completing an export closes the lifecycle: answered → exported,
  // in BOTH stores (previously 'exported' existed in the type but was
  // never set by any flow).
  function markResponsesExported(rs: GeneratedResponse[]) {
    const ids = rs.map((r) => r.id)
    useWizardStore.getState().markExported(ids)
    useReviewStore.getState().markExported(ids)
  }

  // Opening an export now asks the user to NAME the document, pre-filled
  // with the original workbook name.
  function openExportDialog(mode: 'sheet' | 'full') {
    const workbook = useWizardStore.getState().workbook
    if (!workbook) {
      toast.error('No workbook found. Please re-upload your file.')
      return
    }
    setExportName(workbook.filename.replace(/\.(xlsx?|csv)$/i, ''))
    setExportMode(mode)
  }

  function confirmExport() {
    const mode = exportMode
    const workbook = useWizardStore.getState().workbook
    if (!mode || !workbook) return
    const answeredResponses = getExportableResponses()
    const filename = exportName.trim()
    try {
      if (mode === 'full') {
        exportToOriginalWorkbook({ workbook, responses: answeredResponses, filename })
      } else {
        exportSheetAsNewWorkbook({ workbook, responses: answeredResponses, filename })
      }
      markResponsesExported(answeredResponses)
      // Stamp the history ledger with the chosen name
      const rfiId = useWizardStore.getState().currentRfiId
      if (rfiId) {
        useHistoryStore.getState().updateEntry(rfiId, {
          exportedAt: new Date().toISOString(),
          exportedAs: filename ? `${filename}.xlsx` : workbook.filename,
          status: 'exported',
        })
      }
      toast.success(mode === 'full'
        ? 'Exported — answers written into your original file'
        : 'Sheet exported as new file', {
        description: `${answeredResponses.length} answers · saved as ${filename || workbook.filename}.xlsx`,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export failed'
      toast.error('Export failed', { description: msg })
    } finally {
      setExportMode(null)
    }
  }

  // Average confidence over the CURRENT selection's answered responses only
  const answeredCurrent = currentResponses.filter((r) => isAnswered(r.status))
  const avgConfidence = answeredCurrent.length > 0
    ? answeredCurrent.reduce((s, r) => s + (r.confidence?.score ?? 0), 0) / answeredCurrent.length
    : null

  const headerTitle = isRunning
    ? 'Generating answers...'
    : isStopping
      ? 'Stopping...'
      : isStopped
        ? 'Generation paused'
        : allDone
          ? 'Answers ready'
          : 'Generate answers'

  return (
    <MotionConfig reducedMotion="user">
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight mb-1">{headerTitle}</h2>
          <p className="text-sm text-muted-foreground tnum">
            {done} of {total} answered
            {errors > 0 && ` · ${errors} failed`}
            {isStopped && remaining > 0 && ` · ${remaining} remaining`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Stop button — visible while a batch is running */}
          {canGenerate && (isRunning || isStopping) && (
            <Tooltip content="Stop after the current answer — completed answers are kept" side="bottom">
              <button
                onClick={stopGeneration}
                disabled={isStopping}
                aria-label="Stop generation"
                className="btn-danger-outline"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                {isStopping ? 'Stopping…' : 'Stop'}
              </button>
            </Tooltip>
          )}

          {/* Resume button — continues from exactly where it stopped */}
          {canGenerate && canResume && (
            <Tooltip content="Continue generating the remaining answers" side="bottom">
              <button
                onClick={() => startGeneration()}
                aria-label="Resume generation"
                className="btn-primary"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                Resume <span className="tnum">({remaining} left)</span>
              </button>
            </Tooltip>
          )}

          {allDone && (
            <>
              {canCorrect && (
                <Tooltip
                  content={hasReviewItems
                    ? 'Send this sheet to a reviewer'
                    : 'Mark at least one answer "Correct & review" or "Flag for review" first'}
                  side="bottom"
                >
                  <button
                    onClick={handleSendForReview}
                    disabled={!hasReviewItems || submitting}
                    className={cn('btn-primary', (!hasReviewItems || submitting) && 'opacity-50 cursor-not-allowed')}
                  >
                    <Send className="w-4 h-4" />
                    {submitting ? 'Sending…' : 'Send for review'}
                    {hasReviewItems && <span className="tnum">({reviewMarkedIds.length})</span>}
                  </button>
                </Tooltip>
              )}
              <Tooltip content="Download this sheet with answers injected" side="bottom">
                <button onClick={() => openExportDialog('sheet')} className="btn-primary">
                  <Download className="w-4 h-4" />
                  Export sheet
                </button>
              </Tooltip>
              <Tooltip content="Export preserving all sheets, formulas & formatting" side="bottom">
                <button onClick={() => openExportDialog('full')} className="btn-outline">
                  Export full workbook
                </button>
              </Tooltip>
              <div className="w-px h-6 bg-border mx-1" />
              <Tooltip content="Clear and start a new RFP/RFI" side="bottom">
                <button onClick={handleNewRfi} className="btn-ghost">
                  <Upload className="w-3.5 h-3.5" />
                  New RFI
                </button>
              </Tooltip>
            </>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex items-center justify-between text-2xs text-muted-foreground mb-1.5 tnum">
          <span>{progress}% complete</span>
          <span>{done}/{total}</span>
        </div>
        <div className="h-1 bg-muted rounded-full overflow-hidden" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Generation progress">
          <motion.div
            className="h-full bg-primary rounded-full"
            animate={{ width: `${progress}%` }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          />
        </div>
      </div>

      {/* Stats row */}
      {done > 0 && (
        <div className="panel grid grid-cols-3 divide-x divide-border">
          {[
            { label: 'Answered', value: done, color: 'text-success' },
            { label: 'Avg confidence', value: avgConfidence !== null ? formatConfidence(avgConfidence) : '—', color: 'text-foreground' },
            { label: 'Errors', value: errors, color: errors > 0 ? 'text-danger' : 'text-muted-foreground' },
          ].map(({ label, value, color }) => (
            <div key={label} className="px-4 py-3">
              <div className={cn('text-lg font-semibold font-mono tnum', color)}>{value}</div>
              <div className="text-2xs text-muted-foreground uppercase tracking-wide mt-0.5">{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Response cards */}
      <div className="panel divide-y divide-border overflow-hidden">
        <AnimatePresence initial={false}>
          {currentResponses.map((r) => {
            const avail = availabilityConfig(r.availability)
            const expanded = expandedId === r.id
            const editing = editingId === r.id
            const isGeneratingRow = r.status === 'generating'
            const isError = r.status === 'error'

            return (
              <motion.div
                key={r.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.14, ease: 'easeOut' }}
                className={cn(
                  'list-row',
                  isError && 'bg-danger-bg/60 hover:bg-danger-bg'
                )}
              >
                {/* Card header */}
                <div
                  className="flex items-start gap-3 px-4 py-3 cursor-pointer"
                  onClick={() => !isGeneratingRow && setExpandedId(expanded ? null : r.id)}
                >
                  {/* Status icon */}
                  <div className="flex-shrink-0 mt-0.5">
                    {isGeneratingRow ? (
                      <div className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                    ) : isError ? (
                      <AlertCircle className="w-5 h-5 text-danger" />
                    ) : (
                      <div className={cn('w-2.5 h-2.5 rounded-full mt-1', avail.dot)} />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* Section + question */}
                    {r.section && (
                      <p className="text-2xs text-muted-foreground uppercase tracking-wide mb-0.5">{r.section}</p>
                    )}
                    <p className="text-sm font-medium text-foreground line-clamp-2 leading-snug">{r.question}</p>

                    {/* Status line */}
                    {!isGeneratingRow && !isError && (
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        {/* Availability badge */}
                        <span className={cn('badge', avail.color, avail.bg, avail.border)}>
                          {r.availability}
                        </span>

                        {/* Confidence */}
                        <span className={cn(confidenceBg(r.confidence.label), 'tnum')}>
                          <BarChart3 className="w-2.5 h-2.5" />
                          {formatConfidence(r.confidence.score)}
                        </span>

                        {/* Sources */}
                        {r.sources.slice(0, 2).map((s) => {
                          const isCorrection = s.startsWith('[Correction]')
                          const label = isCorrection ? s : s.split('/').pop()?.slice(0, 30)
                          return (
                            <span key={s} className={cn(
                              isCorrection ? 'badge-info' : 'badge-neutral',
                              'font-mono font-normal'
                            )}>
                              {label}
                            </span>
                          )
                        })}

                        {r.editedRemarks != null && r.editedRemarks !== r.remarks && (
                          <span className="badge-warning">Edited</span>
                        )}
                      </div>
                    )}

                    {isGeneratingRow && (
                      <div className="mt-2 space-y-1.5" aria-live="polite" aria-label="Generating answer">
                        <div className="flex items-center gap-1.5">
                          <Sparkles className="w-3 h-3 text-primary animate-pulse" />
                          <span className="text-2xs text-muted-foreground">Generating…</span>
                        </div>
                        <div className="shimmer h-2.5 w-3/4" />
                        <div className="shimmer h-2.5 w-1/2" />
                      </div>
                    )}

                    {isError && (
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-xs text-danger">Generation failed</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); retryOne(r) }}
                          aria-label={`Retry: ${r.question.slice(0, 60)}`}
                          className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1"
                        >
                          <RefreshCw className="w-3 h-3" /> Retry
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Action buttons */}
                  {!isGeneratingRow && !isError && (
                    <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                      {canCorrect && (
                      <Tooltip content="Edit answer" side="top">
                        <button onClick={() => startEdit(r)} aria-label="Edit answer" className="icon-btn-sm">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      </Tooltip>
                      )}
                      {canGenerate && (
                      <Tooltip content="Regenerate" side="top">
                        <button onClick={() => retryOne(r)} aria-label="Regenerate answer" className="icon-btn-sm">
                          <RefreshCw className="w-3.5 h-3.5" />
                        </button>
                      </Tooltip>
                      )}
                      <Tooltip content={expanded ? 'Collapse' : 'View full answer'} side="top">
                        <button
                          onClick={() => setExpandedId(expanded ? null : r.id)}
                          aria-label={expanded ? 'Collapse answer' : 'View full answer'}
                          aria-expanded={expanded}
                          className="icon-btn-sm"
                        >
                          {expanded
                            ? <ChevronUp className="w-4 h-4" />
                            : <ChevronDown className="w-4 h-4" />
                          }
                        </button>
                      </Tooltip>
                    </div>
                  )}
                </div>

                {/* Expanded content */}
                <AnimatePresence>
                  {expanded && !isGeneratingRow && !isError && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.15, ease: 'easeOut' }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4 border-t border-border bg-muted/30 pt-3 space-y-3">

                        {/* Availability selector */}
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Availability:</span>
                          <div className="flex gap-1.5" role="radiogroup" aria-label="Availability">
                            {!canCorrect && <span className="text-2xs text-muted-foreground self-center">view only</span>}
                            {AVAIL_OPTIONS.map((opt) => (
                              <button
                                key={opt}
                                onClick={() => canCorrect && updateResponseAvailability(r.id, opt)}
                                disabled={!canCorrect}
                                role="radio"
                                aria-checked={r.availability === opt}
                                className={cn(
                                  'h-8 px-3 rounded-md text-xs font-semibold border transition-colors duration-150',
                                  r.availability === opt
                                    ? cn(availabilityConfig(opt).color, availabilityConfig(opt).bg, availabilityConfig(opt).border)
                                    : 'text-muted-foreground bg-card border-border hover:bg-accent'
                                )}
                              >
                                {opt}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Review decision (Phase 2): KB-direct / correct+review / flag */}
                        {canCorrect && (
                          <div className="space-y-1.5">
                            <span className="text-xs text-muted-foreground">When done:</span>
                            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Review decision">
                              {([
                                { key: 'kb_direct', label: 'Accept', icon: Check, hint: 'Answer is good as-is — ships in the sheet, no review needed' },
                                { key: 'review', label: 'Correct & review', icon: ClipboardCheck, hint: 'Staged — ingests when a reviewer approves' },
                                { key: 'flag', label: 'Flag for review', icon: Flag, hint: 'Send as-is for a second opinion' },
                              ] as const).map((opt) => {
                                const active = (decisions[r.id] ?? 'kb_direct') === opt.key
                                const Icon = opt.icon
                                return (
                                  <Tooltip key={opt.key} content={opt.hint} side="top">
                                    <button
                                      onClick={() => setDecision(r.id, opt.key)}
                                      role="radio"
                                      aria-checked={active}
                                      className={cn(
                                        'h-8 px-2.5 rounded-md text-xs font-semibold border inline-flex items-center gap-1.5 transition-colors duration-150',
                                        active
                                          ? 'text-primary bg-primary/10 border-primary/40'
                                          : 'text-muted-foreground bg-card border-border hover:bg-accent'
                                      )}
                                    >
                                      <Icon className="w-3 h-3" /> {opt.label}
                                    </button>
                                  </Tooltip>
                                )
                              })}
                            </div>
                          </div>
                        )}

                        {/* Remarks */}
                        {editing ? (
                          <div className="space-y-2">
                            <textarea
                              value={editText}
                              onChange={(e) => setEditText(e.target.value)}
                              rows={5}
                              aria-label="Edit answer text"
                              className="field-area"
                            />
                            <div className="flex gap-2">
                              <button onClick={() => saveEdit(r.id)} className="btn-primary h-8 px-3 text-xs">
                                <Check className="w-3 h-3" /> Save
                              </button>
                              <button onClick={() => setEditingId(null)} className="btn-outline h-8 px-3 text-xs">
                                <X className="w-3 h-3" /> Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm text-foreground leading-relaxed">
                            {r.editedRemarks ?? r.remarks}
                          </p>
                        )}

                        {/* Confidence breakdown */}
                        <div className="bg-card border border-border rounded-md p-3 space-y-1.5">
                          <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Confidence breakdown</p>
                          {Object.entries(r.confidence.breakdown).map(([k, v]) => (
                            <div key={k} className="flex items-center gap-2">
                              <span className="text-2xs text-muted-foreground w-28 capitalize">{k.replace(/([A-Z])/g, ' $1')}</span>
                              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-primary rounded-full"
                                  style={{ width: `${(v as number) * 100}%` }}
                                />
                              </div>
                              <span className="text-2xs font-mono text-muted-foreground w-8 text-right tnum">
                                {Math.round((v as number) * 100)}%
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => useWizardStore.getState().setStep('select')}
            className="btn-ghost"
          >
            ← Back to selection
          </button>
          <button onClick={handleNewRfi} className="btn-outline">
            <Upload className="w-3.5 h-3.5" />
            New RFI
          </button>
        </div>
        {allDone && (
          <div className="flex items-center gap-2">
            <button onClick={() => openExportDialog('sheet')} className="btn-primary">
              <Download className="w-4 h-4" />
              Export sheet
            </button>
            <button onClick={() => openExportDialog('full')} className="btn-outline">
              Export full workbook
            </button>
          </div>
        )}
      </div>

      {/* Export naming dialog */}
      {exportMode && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setExportMode(null)}
        >
          <div
            className="panel w-full max-w-md p-5 space-y-4 shadow-overlay"
            role="dialog"
            aria-modal="true"
            aria-label="Name your export"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <h3 className="text-sm font-semibold">Name your document</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                {exportMode === 'full'
                  ? 'Full workbook with answers written into your original sheets'
                  : 'Clean new workbook containing the answered sheet'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={exportName}
                onChange={(e) => setExportName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmExport()
                  if (e.key === 'Escape') setExportMode(null)
                }}
                aria-label="Export file name"
                className="field flex-1"
              />
              <span className="text-xs text-muted-foreground font-mono">.xlsx</span>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setExportMode(null)} className="btn-outline">Cancel</button>
              <button onClick={confirmExport} disabled={!exportName.trim()} className="btn-primary">
                <Download className="w-4 h-4" />
                Export
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </MotionConfig>
  )
}
