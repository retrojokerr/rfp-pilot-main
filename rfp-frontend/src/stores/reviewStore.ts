import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useFeedbackStore } from '@/stores/feedbackStore'
import { useWizardStore } from '@/stores/wizardStore'
import { ingestCorrection, fetchReviewQueue, saveReviewQueue } from '@/services/api'
import type {
  GeneratedResponse,
  ResponseStatus,
  AuditEvent,
  AuditEventType,
  AvailabilityLabel,
} from '@/types'

function makeId() { return Math.random().toString(36).slice(2, 10) }
let _saveTimer: ReturnType<typeof setTimeout> | null = null
function now() { return new Date().toISOString() }

// ── Actor ─────────────────────────────────────────────────────
// Set from the next-auth session by AppLayout. Falls back to a neutral
// label instead of a hardcoded person's name.
let ACTOR = 'Reviewer'
export function setReviewActor(name?: string | null) {
  if (name && name.trim()) ACTOR = name.trim()
}

function addAudit(r: GeneratedResponse, type: AuditEventType, note?: string): AuditEvent[] {
  return [...(r.auditLog ?? []), { id: makeId(), type, actor: ACTOR, timestamp: now(), note }]
}

// ── Mirror-back ───────────────────────────────────────────────
// reviewStore is the system of record for review state; wizardStore is the
// working copy of the ACTIVE RFI. Every review decision is mirrored into
// the wizard (no-op when the id belongs to an older RFI) so the workbook
// export always reflects the latest reviewed content.
function mirrorToWizard(id: string, patch: Partial<GeneratedResponse>) {
  useWizardStore.getState().applyReviewDecision(id, patch)
}

// ── Knowledge-base learning ───────────────────────────────────
// SINGLE place where an approval feeds the KB. (The review-queue page used
// to duplicate this — approving an edited answer ingested twice.)
function learnFromApproval(r: GeneratedResponse) {
  if (!r.editedRemarks || r.editedRemarks.trim() === '' || r.editedRemarks === r.remarks) return
  ingestCorrection({
    question: r.question,
    good_answer: r.editedRemarks,
    section: r.section,
    source: 'review_queue',
  }).catch(() => { /* logged in feedback store; KB sync can be retried */ })
}

interface ReviewStore {
  responses: GeneratedResponse[]

  // Upsert
  upsertResponse: (r: GeneratedResponse) => void
  upsertMany: (rs: GeneratedResponse[]) => void

  // Status
  setStatus: (id: string, status: ResponseStatus, note?: string) => void
  approve: (id: string) => void
  reject: (id: string, reason?: string) => void
  markNeedsReview: (id: string) => void
  markExported: (ids: string[]) => void

  // Editing
  editRemarks: (id: string, remarks: string) => void
  editAvailability: (id: string, availability: AvailabilityLabel) => void

  // Comments
  addComment: (id: string, text: string) => void
  deleteComment: (id: string, commentId: string) => void

  // Version restore
  restoreVersion: (id: string, versionId: string) => void

  // Queries
  getById: (id: string) => GeneratedResponse | undefined
  getByStatus: (status: ResponseStatus) => GeneratedResponse[]
  getLowConfidence: (threshold?: number) => GeneratedResponse[]
  getStats: () => {
    total: number
    generated: number
    needsReview: number
    approved: number
    rejected: number
    exported: number
    lowConfidence: number
    avgConfidence: number
  }

  clear: () => void
}

export const useReviewStore = create<ReviewStore>()(
  persist(
    (set, get) => ({
      responses: [],

      upsertResponse: (response) =>
        set((s) => {
          const idx = s.responses.findIndex((r) => r.id === response.id)
          if (idx >= 0) {
            const next = [...s.responses]
            next[idx] = response
            return { responses: next }
          }
          return { responses: [...s.responses, response] }
        }),

      upsertMany: (rs) =>
        set((s) => {
          const map = new Map(s.responses.map((r) => [r.id, r]))
          rs.forEach((r) => map.set(r.id, r))
          return { responses: Array.from(map.values()) }
        }),

      setStatus: (id, status, note) => {
        set((s) => ({
          responses: s.responses.map((r) =>
            r.id !== id ? r : {
              ...r, status,
              auditLog: addAudit(r, status as AuditEventType, note),
            }
          ),
        }))
        mirrorToWizard(id, { status })
      },

      approve: (id) => {
        const r = get().responses.find((x) => x.id === id)
        if (r) {
          useFeedbackStore.getState().capture({
            question: r.question,
            section: r.section,
            badAnswer: r.remarks,
            goodAnswer: r.editedRemarks ?? r.remarks,
            availability: r.availability,
            confidence: r.confidence?.score ?? 0,
            signal: 'approved',
            source: 'review_queue',
          })
          learnFromApproval(r)
        }
        set((s) => ({
          responses: s.responses.map((x) =>
            x.id !== id ? x : {
              ...x,
              status: 'approved' as ResponseStatus,
              reviewedAt: now(),
              reviewedBy: ACTOR,
              auditLog: addAudit(x, 'approved'),
            }
          ),
        }))
        // Exports must ship the approved content, not the pre-review one
        mirrorToWizard(id, {
          status: 'approved',
          ...(r?.editedRemarks ? { editedRemarks: r.editedRemarks } : {}),
          ...(r ? { availability: r.availability } : {}),
        })
      },

      reject: (id, reason) => {
        const r = get().responses.find((x) => x.id === id)
        if (r) {
          useFeedbackStore.getState().capture({
            question: r.question,
            section: r.section,
            badAnswer: r.remarks,
            goodAnswer: r.editedRemarks ?? '',
            availability: r.availability,
            confidence: r.confidence?.score ?? 0,
            signal: 'rejected',
            source: 'review_queue',
            notes: reason,
          })
        }
        set((s) => ({
          responses: s.responses.map((x) =>
            x.id !== id ? x : {
              ...x,
              status: 'rejected' as ResponseStatus,
              reviewedAt: now(),
              reviewedBy: ACTOR,
              auditLog: addAudit(x, 'rejected', reason),
            }
          ),
        }))
        mirrorToWizard(id, { status: 'rejected' })
      },

      markNeedsReview: (id) => {
        set((s) => ({
          responses: s.responses.map((r) =>
            r.id !== id ? r : {
              ...r,
              status: 'needs_review' as ResponseStatus,
              auditLog: addAudit(r, 'edited'),
            }
          ),
        }))
        mirrorToWizard(id, { status: 'needs_review' })
      },

      markExported: (ids) => {
        const idSet = new Set(ids)
        set((s) => ({
          responses: s.responses.map((r) =>
            idSet.has(r.id) ? {
              ...r,
              status: 'exported' as ResponseStatus,
              auditLog: addAudit(r, 'exported'),
            } : r
          ),
        }))
        // wizardStore.markExported is called by the export flow itself
      },

      editRemarks: (id, remarks) => {
        set((s) => ({
          responses: s.responses.map((r) => {
            if (r.id !== id) return r
            const version = {
              id: makeId(),
              remarks: r.editedRemarks ?? r.remarks,
              availability: r.availability,
              editedAt: now(),
              editedBy: ACTOR,
            }
            return {
              ...r,
              editedRemarks: remarks,
              // An edit re-enters review — this is the lifecycle rule, not
              // a separate 'edited' status.
              status: 'needs_review' as ResponseStatus,
              versions: [...(r.versions ?? []), version],
              auditLog: addAudit(r, 'edited'),
            }
          }),
        }))
        mirrorToWizard(id, { editedRemarks: remarks, status: 'needs_review' })
      },

      editAvailability: (id, availability) => {
        set((s) => ({
          responses: s.responses.map((r) =>
            r.id !== id ? r : {
              ...r, availability,
              status: 'needs_review' as ResponseStatus,
              auditLog: addAudit(r, 'edited'),
            }
          ),
        }))
        mirrorToWizard(id, { availability, status: 'needs_review' })
      },

      addComment: (id, text) =>
        set((s) => ({
          responses: s.responses.map((r) =>
            r.id !== id ? r : {
              ...r,
              comments: [...(r.comments ?? []), {
                id: makeId(), text, author: ACTOR, createdAt: now(),
              }],
              auditLog: addAudit(r, 'commented', text.slice(0, 60)),
            }
          ),
        })),

      deleteComment: (id, commentId) =>
        set((s) => ({
          responses: s.responses.map((r) =>
            r.id !== id ? r : {
              ...r,
              comments: (r.comments ?? []).filter((c) => c.id !== commentId),
            }
          ),
        })),

      restoreVersion: (id, versionId) => {
        let restored: { remarks: string; availability: AvailabilityLabel } | null = null
        set((s) => ({
          responses: s.responses.map((r) => {
            if (r.id !== id) return r
            const v = (r.versions ?? []).find((v) => v.id === versionId)
            if (!v) return r
            restored = { remarks: v.remarks, availability: v.availability }
            return {
              ...r,
              editedRemarks: v.remarks,
              availability: v.availability,
              auditLog: addAudit(r, 'restored', `Restored version ${versionId}`),
            }
          }),
        }))
        if (restored) {
          mirrorToWizard(id, {
            editedRemarks: (restored as { remarks: string }).remarks,
            availability: (restored as { availability: AvailabilityLabel }).availability,
          })
        }
      },

      getById: (id) => get().responses.find((r) => r.id === id),

      getByStatus: (status) => get().responses.filter((r) => r.status === status),

      getLowConfidence: (threshold = 0.7) =>
        get().responses.filter((r) => r.confidence?.score < threshold),

      getStats: () => {
        const rs = get().responses
        const answered = rs.filter((r) => r.status !== 'generating' && r.status !== 'error')
        const scores = answered.map((r) => r.confidence?.score ?? 0).filter(Boolean)
        return {
          total: rs.length,
          generated: rs.filter((r) => r.status === 'generated').length,
          needsReview: rs.filter((r) => r.status === 'needs_review').length,
          approved: rs.filter((r) => r.status === 'approved').length,
          rejected: rs.filter((r) => r.status === 'rejected').length,
          exported: rs.filter((r) => r.status === 'exported').length,
          lowConfidence: rs.filter((r) => (r.confidence?.score ?? 0) < 0.7).length,
          avgConfidence: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
        }
      },

      clear: () => set({ responses: [] }),
    }),
    {
      name: 'rfp-review-store',
      // M4: server-backed persistence. Store logic unchanged; only the
      // persistence layer moved from localStorage to the backend.
      storage: {
        getItem: async (_name: string) => {
          try {
            const responses = await fetchReviewQueue()
            return { state: { responses }, version: 2 }
          } catch {
            return null
          }
        },
        setItem: (_name: string, value: { state: { responses: unknown[] } }) => {
          const responses = value?.state?.responses ?? []
          if (_saveTimer) clearTimeout(_saveTimer)
          _saveTimer = setTimeout(() => {
            saveReviewQueue(responses).catch(() => { /* retried on next mutation */ })
          }, 600)
        },
        removeItem: async (_name: string) => {
          saveReviewQueue([]).catch(() => {})
        },
      },
      version: 2,
      skipHydration: false,
      // Sanitise data persisted before the status cleanup: 'edited' was both
      // a status and a flag; 'draft'/'done' were phantoms.
      migrate: (persisted: unknown) => {
        const state = persisted as { responses?: GeneratedResponse[] }
        if (state?.responses) {
          state.responses = state.responses.map((r) => {
            const legacy = r.status as string
            if (legacy === 'edited') return { ...r, status: 'needs_review' as ResponseStatus }
            if (legacy === 'draft' || legacy === 'done') return { ...r, status: 'generated' as ResponseStatus }
            return r
          })
        }
        return state as never
      },
    }
  )
)
