import axios from 'axios'
import { getAppSettings } from '@/utils/helpers'
import type { AnswerRequest, AnswerResponse, KBStats, KBDocument } from '@/types'

const DEFAULT_API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

const api = axios.create({
  // 30s was too tight for cold-start RAG calls; generation requests can be
  // cancelled explicitly via AbortSignal instead of relying on a short timeout.
  timeout: 60_000,
  headers: { 'Content-Type': 'application/json' },
})

// ── Auth: attach a short-lived API token to every request ────
// The token is minted by our own Next route (/api/token) from the NextAuth
// session and verified by the backend, which resolves the user's role
// server-side. Cached in memory and refreshed ~1 min before expiry.
let cachedToken: { token: string; expiresAt: number } | null = null

async function getApiToken(force = false): Promise<string | null> {
  if (typeof window === 'undefined') return null
  if (!force && cachedToken && cachedToken.expiresAt - Date.now() > 60_000) {
    return cachedToken.token
  }
  try {
    const res = await fetch('/api/token')
    if (!res.ok) return null
    cachedToken = await res.json()
    return cachedToken?.token ?? null
  } catch {
    return null
  }
}

// Resolve the base URL on every request so the value saved in Settings
// takes effect immediately, without a rebuild or reload.
api.interceptors.request.use(async (config) => {
  config.baseURL = getAppSettings().apiUrl || DEFAULT_API_BASE
  const token = await getApiToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// One transparent retry on 401 with a freshly minted token (handles the
// token expiring between cache check and server verification).
api.interceptors.response.use(undefined, async (error) => {
  const original = error?.config
  if (axios.isAxiosError(error) && error.response?.status === 401 && original && !original._retried) {
    original._retried = true
    const token = await getApiToken(true)
    if (token) {
      original.headers.Authorization = `Bearer ${token}`
      return api.request(original)
    }
  }
  return Promise.reject(error)
})

// ── Health / Knowledge ────────────────────────────────────────

export async function fetchKnowledgeStats(): Promise<KBStats> {
  const { data } = await api.get('/knowledge')
  return {
    vectorCount: data.vector_count ?? 0,
    documentCount: data.document_count ?? 0,
    lastSynced: data.last_synced ?? new Date().toISOString(),
    driveConnected: data.drive_connected ?? false,
    categories: data.categories ?? [],
  }
}

export async function checkHealth(): Promise<boolean> {
  // Prefer the cheap dedicated /health endpoint; fall back to /knowledge
  // for older backend builds that don't have it yet.
  try {
    await api.get('/health', { timeout: 4_000 })
    return true
  } catch {
    try {
      await api.get('/knowledge', { timeout: 4_000 })
      return true
    } catch {
      return false
    }
  }
}

// ── Answer generation ─────────────────────────────────────────

export async function generateAnswer(
  req: AnswerRequest,
  signal?: AbortSignal
): Promise<AnswerResponse> {
  const { data } = await api.post('/answer', req, { signal })
  return data
}

export async function generateAnswersBatch(
  items: AnswerRequest[],
  onProgress?: (index: number, total: number, answer: AnswerResponse) => void,
  delayMs = 300,
  signal?: AbortSignal
): Promise<AnswerResponse[]> {
  const results: AnswerResponse[] = []

  for (let i = 0; i < items.length; i++) {
    if (signal?.aborted) break
    const answer = await generateAnswer(items[i], signal)
    results.push(answer)
    onProgress?.(i + 1, items.length, answer)
    if (i < items.length - 1 && !signal?.aborted) {
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }

  return results
}

// ── Export ────────────────────────────────────────────────────

export async function exportToExcel(docId: string): Promise<Blob> {
  const { data } = await api.post(
    '/export',
    { doc_id: docId, format: 'xlsx' },
    { responseType: 'blob' }
  )
  return data
}

// ── Knowledge base ────────────────────────────────────────────

export async function fetchDocuments(): Promise<KBDocument[]> {
  const { data } = await api.get('/documents')
  return data
}

export async function deleteDocument(id: string): Promise<void> {
  await api.delete(`/documents/${id}`)
}

export async function reindexDocument(id: string): Promise<void> {
  await api.post(`/documents/${id}/reindex`)
}

// NOTE: there is intentionally no KB file-upload API — Google Drive is the
// single source of truth for knowledge documents. Add files to the Drive
// folder, then trigger a sync.
export async function triggerDriveSync(): Promise<{ status: string }> {
  const { data } = await api.post('/knowledge/sync')
  return data
}

export async function getDriveSyncStatus(): Promise<{ running: boolean; last_started?: string }> {
  const { data } = await api.get('/knowledge/sync')
  return data
}

// ── Error classification ──────────────────────────────────────

export function parseApiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail
    if (typeof detail === 'string') return detail
    if (detail && typeof detail === 'object') return JSON.stringify(detail)
    return error.message
  }
  if (error instanceof Error) return error.message
  return 'Unknown error'
}

/**
 * Rate-limit detection done properly: check the HTTP status code first
 * (the backend now returns a real 429), then fall back to message
 * sniffing for older backend builds that wrapped Groq 429s in a 500.
 */
export function isRateLimitError(error: unknown): boolean {
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 429) return true
    const detail = String(error.response?.data?.detail ?? error.message ?? '')
    return /\b429\b/.test(detail) || /rate[ _-]?limit/i.test(detail)
  }
  return false
}

/** True when the request was cancelled via AbortController (user pressed Stop). */
export function isAbortError(error: unknown): boolean {
  if (axios.isCancel(error)) return true
  if (error instanceof Error) {
    return error.name === 'CanceledError' || error.name === 'AbortError'
  }
  return false
}

// ── RFI history (org-wide, server-side) ──────────────────────

export async function fetchHistoryEntries<T = unknown>(): Promise<T[]> {
  const { data } = await api.get('/history')
  return data?.entries ?? []
}

export async function upsertHistoryEntry(entry: { id: string } & object): Promise<void> {
  await api.put('/history', entry)
}

export async function deleteHistoryEntry(id: string): Promise<void> {
  await api.delete(`/history/${encodeURIComponent(id)}`)
}

// ── Identity & user management (RBAC) ────────────────────────

export type Role = 'admin' | 'solutions_engineer' | 'reviewer' | 'readonly'

export interface Me {
  email: string
  name: string
  role: Role
  capabilities: string[]
}

export interface ManagedUser {
  email: string
  role: Role
  updated_by?: string
  updated_at?: string
}

export async function getMe(): Promise<Me> {
  const { data } = await api.get('/me')
  return data
}

export async function listUsers(): Promise<{ users: ManagedUser[]; roles: Role[] }> {
  const { data } = await api.get('/admin/users')
  return data
}

export async function upsertUser(email: string, role: Role): Promise<void> {
  await api.put('/admin/users', { email, role })
}

export async function removeUser(email: string): Promise<void> {
  await api.delete(`/admin/users/${encodeURIComponent(email)}`)
}

export function isForbiddenError(error: unknown): boolean {
  return axios.isAxiosError(error) && error.response?.status === 403
}

// ── Feedback loop ─────────────────────────────────────────────

export interface SharedFeedbackPair {
  signal?: string
  question?: string
  good_answer?: string
  bad_answer?: string
  section?: string
  source?: string
  user?: string
  email?: string
  confidence?: number
  logged_at?: string
}

/** Org-wide correction history (all users), via the authed client. */
export async function fetchSharedFeedback(): Promise<SharedFeedbackPair[]> {
  const { data } = await api.get('/feedback')
  return data?.pairs ?? []
}


export async function ingestCorrection(params: {
  question: string
  good_answer: string
  section?: string
  source?: string
}): Promise<void> {
  await api.post('/feedback/ingest', params)
}

// ── Review queue (server-side persistence, M4) ───────────────
export async function fetchReviewQueue(): Promise<unknown[]> {
  const { data } = await api.get('/review-queue')
  return data.responses ?? []
}

export async function saveReviewQueue(responses: unknown[]): Promise<void> {
  await api.put('/review-queue', { responses })
}

export async function fetchStats(): Promise<Record<string, number>> {
  const { data } = await api.get('/stats')
  return data
}

// ── Review workflow: submissions (Phase 1) ───────────────────
export type ReviewFlagType = 'accepted' | 'corrected' | 'flagged' | 'untouched'

export interface ReviewItemPayload {
  question_id: string
  question: string
  section?: string
  answer: string
  original_answer?: string
  corrected_answer?: string
  flag_type: ReviewFlagType
  confidence?: number
  availability?: string
}

export interface ReviewItem extends ReviewItemPayload {
  decision?: 'approved' | 'rejected' | null
  comment?: string | null
}

export interface ReviewSubmission {
  id: string
  doc_id: string
  sheet_name: string
  submitted_by: string
  submitted_at: string | null
  status: 'pending' | 'approved' | 'sent_back'
  reviewed_by: string | null
  reviewed_at: string | null
  reviewer_comment: string | null
  previous_submission_id?: string | null
  cycle?: number
  display_name?: string | null
  items: ReviewItem[]
  counts: { total: number; corrected: number; flagged: number; accepted: number }
}

export interface ItemDecisionPayload {
  question_id: string
  decision: 'approved' | 'rejected'
  corrected_answer?: string
  comment?: string
}

export async function createSubmission(payload: {
  doc_id: string
  sheet_name: string
  items: ReviewItemPayload[]
  previous_submission_id?: string
  // Phase 5: header text of the mapped columns in the original workbook.
  // The backend export endpoint uses these to locate write-back targets.
  question_col_name?: string
  availability_col_name?: string
  remarks_col_name?: string
  display_name?: string
}): Promise<ReviewSubmission> {
  const { data } = await api.post('/review/submissions', payload)
  return data
}

// ── Phase 5: raw-bytes upload for the export write-back path ─────────────────
export interface UploadDocumentResult {
  doc_id: string
  status: 'stored' | 'already_stored'
  bytes: number
  filename: string
}

export async function uploadRawDocument(
  docId: string,
  buffer: ArrayBuffer,
  filename: string,
): Promise<UploadDocumentResult> {
  const form = new FormData()
  const blob = new Blob([buffer], { type: 'application/octet-stream' })
  form.append('file', blob, filename)
  form.append('doc_id', docId)
  // The axios instance defaults to Content-Type: application/json. If we
  // don't override it here, axios JSON-stringifies the FormData (arriving
  // at the backend as an empty JSON body). Setting multipart/form-data
  // tells axios to serialize as multipart and auto-generate the boundary.
  const { data } = await api.post('/documents/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  })
  return data
}

// Phase 5: fetch the answered xlsx for a submission and trigger a browser
// download. Uses the filename the backend puts in Content-Disposition;
// falls back to a name derived from the submission's display/sheet name.
// On error, tries to unpack the JSON detail out of the error blob so the
// caller can surface a useful toast instead of "Request failed".
export interface ExportSummary {
  written: number
  skipped: number        // answers that could not be placed into the sheet
  mergedSkipped: number  // rows skipped because they are merged section banners
}

export async function downloadAnsweredSheet(
  submissionId: string,
  fallbackName?: string,
): Promise<ExportSummary> {
  try {
    const res = await api.get(`/review/submissions/${submissionId}/export`, {
      responseType: 'blob',
    })
    const dispo: string = res.headers['content-disposition'] || ''
    const match = /filename="?([^";]+)"?/.exec(dispo)
    const filename = match?.[1] || `${fallbackName || submissionId}_answered.xlsx`

    const url = URL.createObjectURL(res.data as Blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    const written = parseInt(res.headers['x-items-written'] || '0', 10) || 0
    const skippedRaw = (res.headers['x-items-skipped'] || '').trim()
    const skipped = skippedRaw ? skippedRaw.split(',').filter(Boolean).length : 0
    const mergedSkipped = parseInt(res.headers['x-rows-skipped-merged'] || '0', 10) || 0
    return { written, skipped, mergedSkipped }
  } catch (err: any) {
    // With responseType: 'blob', axios wraps error bodies as Blobs too.
    // Try to pull out {"detail": "..."} for a useful message.
    let msg = 'Download failed'
    const data = err?.response?.data
    if (data instanceof Blob) {
      try {
        const parsed = JSON.parse(await data.text())
        if (parsed?.detail) msg = parsed.detail
      } catch {
        /* fall through — keep generic msg */
      }
    } else if (err?.message) {
      msg = err.message
    }
    throw new Error(msg)
  }
}

export async function listSubmissions(): Promise<ReviewSubmission[]> {
  const { data } = await api.get('/review/submissions')
  return data.submissions ?? []
}

export async function getSubmission(id: string): Promise<ReviewSubmission> {
  const { data } = await api.get(`/review/submissions/${id}`)
  return data
}

export async function approveSubmission(
  id: string,
  payload?: { edits?: Record<string, string> },
): Promise<{ status: string; ingested: number }> {
  const { data } = await api.post(`/review/submissions/${id}/approve`, payload ?? {})
  return data
}

export async function sendBackSubmission(id: string, payload: {
  decisions: ItemDecisionPayload[]
  reviewer_comment?: string
}): Promise<{ status: string }> {
  const { data } = await api.post(`/review/submissions/${id}/send-back`, payload)
  return data
}

// ── Notifications (in-app) ───────────────────────────────────
export interface AppNotification {
  id: string
  type: string
  message: string
  link: string | null
  read: boolean
  created_at: string | null
}

export async function fetchNotifications(): Promise<{ notifications: AppNotification[]; unread: number }> {
  const { data } = await api.get('/review/notifications')
  return data
}

export async function markNotificationRead(id: string): Promise<void> {
  await api.post(`/review/notifications/${id}/read`)
}

export async function markAllNotificationsRead(): Promise<void> {
  await api.post('/review/notifications/read-all')
}

// ── Dashboard stats (server-computed, honest metrics) ────────
export interface DashboardStats {
  rfps_processed: number
  in_review: number
  completed: number
  days_saved: number
  hours_saved: number
  median_review_minutes: number
  avg_confidence: number
  assumptions: { manual_hours_per_rfp: number; generation_hours_per_rfp: number }
}

export async function fetchDashboardStats(): Promise<DashboardStats> {
  const { data } = await api.get('/review/dashboard-stats')
  return data
}
