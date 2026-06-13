/**
 * generationEngine.ts — Module-level answer-generation engine.
 *
 * WHY THIS EXISTS (the bug it fixes):
 * The generation loop used to live inside <GenerateStep/>. When the user
 * navigated to another page (Dashboard, Knowledge, …) the component
 * unmounted, its `hasStarted` ref was destroyed, and on returning to the
 * Workspace the `useEffect` fired again and RESTARTED generation from
 * scratch — while the orphaned first loop was often still running in the
 * background, double-calling the API.
 *
 * This engine lives at module scope (like bufferStore), so:
 *   - It runs exactly ONCE per batch, no matter how many times the
 *     component mounts/unmounts. Navigating away does NOT interrupt it;
 *     navigating back simply re-attaches the UI to live progress.
 *   - It is idempotent: items that already have an answered response are
 *     skipped, so "Resume" continues from where it stopped.
 *   - It supports a hard STOP via AbortController: the in-flight HTTP
 *     request is cancelled, everything completed so far is kept, and the
 *     remaining items stay pending so they can be resumed later.
 */

import { toast } from 'sonner'
import { useWizardStore } from './wizardStore'
import { useReviewStore } from './reviewStore'
import {
  generateAnswer,
  parseApiError,
  isRateLimitError,
  isAbortError,
} from '@/services/api'
import { isAnswered, getAppSettings } from '@/utils/helpers'
import { useHistoryStore } from './historyStore'
import type { ExtractedItem, GeneratedResponse } from '@/types'

// ── Module-level singleton state (never serialised, never in React) ──
let controller: AbortController | null = null
let running = false

export function isGenerationRunning(): boolean {
  return running
}

// ── Helpers ───────────────────────────────────────────────────

function makePlaceholder(item: ExtractedItem): GeneratedResponse {
  return {
    id: item.id,
    question: item.question,
    section: item.section,
    subsection: item.subsection,
    itemType: item.itemType,
    priority: item.priority,
    availability: 'Unknown',
    remarks: '',
    sources: [],
    confidence: {
      score: 0,
      label: 'low',
      color: 'red',
      breakdown: { semantic: 0, sourceQuality: 0, recency: 0, corroboration: 0 },
    },
    status: 'generating',
    comments: [],
    versions: [],
    auditLog: [],
  }
}

/** A setTimeout that resolves immediately if the signal aborts. */
function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

// ── Public API ────────────────────────────────────────────────

/**
 * Start (or resume) generation for the current selection.
 * Safe to call repeatedly — a no-op if a run is already in progress,
 * and already-answered items are never regenerated.
 */
export async function startGeneration(): Promise<void> {
  if (running) return // a batch is already in flight — just let the UI re-attach

  const store = useWizardStore.getState
  const s = store()

  // Build the work queue: selected items that don't yet have a usable answer.
  // ('error' and stale 'generating' placeholders are re-queued — this is what
  // makes Resume and rate-limit recovery work.)
  const answeredIds = new Set(
    s.responses.filter((r) => isAnswered(r.status)).map((r) => r.id)
  )
  const queue = s.items.filter(
    (i) => s.selectedIds.has(i.id) && !answeredIds.has(i.id)
  )

  if (queue.length === 0) {
    // Everything in the selection is already answered (e.g. user navigated
    // back to a finished batch). Just mark the run completed — do NOT restart.
    s.setGenerationStatus(s.selectedIds.size > 0 ? 'completed' : 'idle')
    return
  }

  running = true
  controller = new AbortController()
  const signal = controller.signal
  s.setGenerationStatus('running')

  const delayMs = Math.max(0, getAppSettings().requestDelayMs)
  let completed = 0
  let failed = 0
  let stoppedByUser = false
  let stoppedByRateLimit = false

  for (const item of queue) {
    if (signal.aborted) {
      stoppedByUser = true
      break
    }

    store().setGenerating(item.id)
    store().upsertResponse(makePlaceholder(item))

    try {
      const result = await generateAnswer(
        { question: item.question, section: item.section },
        signal
      )

      const confidenceScore = result.confidence?.score ?? 0
      const response: GeneratedResponse = {
        id: item.id,
        question: item.question,
        section: item.section,
        subsection: item.subsection,
        itemType: item.itemType,
        priority: item.priority,
        availability: result.availability,
        remarks: result.remarks,
        sources: result.sources,
        confidence: result.confidence,
        status: confidenceScore < 0.7 ? 'needs_review' : 'generated',
        generatedAt: new Date().toISOString(),
        comments: [],
        versions: [],
        auditLog: [
          {
            id: Math.random().toString(36).slice(2),
            type: 'generated',
            actor: 'System',
            timestamp: new Date().toISOString(),
          },
        ],
      }

      store().upsertResponse(response)
      useReviewStore.getState().upsertResponse(response)
      completed++
    } catch (err) {
      if (isAbortError(err) || signal.aborted) {
        // The user pressed Stop mid-request. Remove the half-baked
        // placeholder so this item is cleanly re-queued on Resume.
        store().removeResponse(item.id)
        stoppedByUser = true
        break
      }

      store().updateResponseStatus(item.id, 'error')
      failed++

      if (isRateLimitError(err)) {
        stoppedByRateLimit = true
        toast.error('Rate limit reached', {
          description:
            'The model provider is throttling requests. Wait a minute, then press Resume — completed answers are kept.',
        })
        break
      }

      toast.error(`Failed: ${item.question.slice(0, 40)}…`, {
        description: parseApiError(err),
      })
    }

    if (delayMs > 0 && !signal.aborted) {
      await abortableDelay(delayMs, signal)
    }
  }

  store().setGenerating(null)
  running = false
  controller = null

  syncHistory()

  if (stoppedByUser || stoppedByRateLimit) {
    store().setGenerationStatus('stopped')
    if (stoppedByUser) {
      toast.info(
        `Generation stopped — ${completed} answer${completed === 1 ? '' : 's'} kept`,
        { description: 'Press Resume to continue from where it stopped.' }
      )
    }
  } else {
    store().setGenerationStatus('completed')
    if (completed > 0) {
      toast.success(
        `${completed} answer${completed === 1 ? '' : 's'} generated`,
        {
          description:
            failed > 0
              ? `${failed} failed — retry them from the list`
              : 'Ready to review and export',
        }
      )
    }
  }
}

/** Push the current run's stats into the history ledger. */
function syncHistory() {
  const s = useWizardStore.getState()
  if (!s.currentRfiId) return
  const current = s.responses.filter((r) => s.selectedIds.has(r.id))
  const answeredRs = current.filter((r) => isAnswered(r.status))
  const scores = answeredRs.map((r) => r.confidence?.score ?? 0).filter(Boolean)
  useHistoryStore.getState().updateEntry(s.currentRfiId, {
    selectedCount: s.selectedIds.size,
    answered: answeredRs.length,
    needsReview: current.filter((r) => r.status === 'needs_review').length,
    approved: current.filter((r) => r.status === 'approved').length,
    errors: current.filter((r) => r.status === 'error').length,
    avgConfidence: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
    status: 'generated',
  })
}

/**
 * Stop the current batch. The in-flight request is aborted, completed
 * answers are preserved, and remaining items stay pending for Resume.
 */
export function stopGeneration(): void {
  if (!running || !controller) return
  useWizardStore.getState().setGenerationStatus('stopping')
  controller.abort()
}

/**
 * Hard reset — used when starting a brand-new RFI (new upload / "New RFI").
 * Aborts any in-flight run silently without the "stopped" toast semantics.
 */
export function resetGeneration(): void {
  controller?.abort()
  controller = null
  running = false
  useWizardStore.getState().setGenerationStatus('idle')
}
