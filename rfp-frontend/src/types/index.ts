// ── Column mapping ────────────────────────────────────────────
export type ColumnRole = 'question' | 'section' | 'subsection' | 'skip' | 'response' | 'availability_out' | 'remarks_out' | 'unassigned'

export interface SheetColumn {
  index: number
  name: string
  role: ColumnRole
  sample: string[]
  autoDetected: boolean
}

export interface SheetData {
  name: string
  columns: SheetColumn[]
  rows: Record<string, string>[]
  rowCount: number
}

export interface WorkbookData {
  filename: string
  sheets: SheetData[]
  activeSheet: string
  rawBuffer?: ArrayBuffer   // original file buffer for write-back export
}

// ── Response lifecycle ────────────────────────────────────────
// Lifecycle: generating → generated | needs_review | error
//            reviewer:   → approved | rejected
//            export sets → exported
// "Edited" is NOT a status — it is derived from `editedRemarks != null`.
// An edit re-enters review by setting status back to 'needs_review'.
export type ResponseStatus =
  | 'generating'
  | 'generated'
  | 'needs_review'
  | 'approved'
  | 'rejected'
  | 'exported'
  | 'error'

export type ItemType = 'question' | 'requirement' | 'compliance' | 'use_case' | 'action_item'
export type Priority = 'high' | 'medium' | 'low'
export type AvailabilityLabel = 'Yes' | 'No' | 'Partial' | 'Unknown'

export interface ExtractedItem {
  id: string
  section: string
  subsection: string
  question: string
  itemType: ItemType
  priority: Priority
  sourceRow: number
  rawText: string
}

// ── Confidence ────────────────────────────────────────────────
export interface ConfidenceBreakdown {
  semantic: number
  sourceQuality: number
  recency: number
  corroboration: number
}

export interface ConfidenceScore {
  score: number
  label: 'high' | 'medium' | 'low'
  color: 'green' | 'amber' | 'red'
  breakdown: ConfidenceBreakdown
}

// ── Audit ─────────────────────────────────────────────────────
export type AuditEventType =
  | 'generated' | 'edited' | 'approved' | 'rejected'
  | 'exported' | 'commented' | 'regenerated' | 'restored'

export interface AuditEvent {
  id: string
  type: AuditEventType
  actor: string
  timestamp: string
  note?: string
}

// ── Response version ──────────────────────────────────────────
export interface ResponseVersion {
  id: string
  remarks: string
  availability: AvailabilityLabel
  editedAt: string
  editedBy: string
}

// ── Review comment ────────────────────────────────────────────
export interface ReviewComment {
  id: string
  text: string
  author: string
  createdAt: string
}

// ── Generated response ────────────────────────────────────────
export interface GeneratedResponse {
  id: string
  question: string
  section: string
  subsection: string
  itemType: ItemType
  priority: Priority
  availability: AvailabilityLabel
  remarks: string
  sources: string[]
  confidence: ConfidenceScore
  status: ResponseStatus
  editedRemarks?: string
  generatedAt?: string
  reviewedAt?: string
  reviewedBy?: string
  comments: ReviewComment[]
  versions: ResponseVersion[]
  auditLog: AuditEvent[]
}

// ── Project ───────────────────────────────────────────────────
export type ProjectStatus = 'draft' | 'in_progress' | 'review' | 'approved' | 'exported'

export interface Project {
  id: string
  name: string
  filename: string
  status: ProjectStatus
  totalQuestions: number
  answeredQuestions: number
  needsReview: number
  approved: number
  rejected: number
  avgConfidence: number
  createdAt: string
  updatedAt: string
  exportedAt?: string
  assignedReviewers: string[]
}

// ── KB ────────────────────────────────────────────────────────
export type DocumentStatus = 'ingesting' | 'indexed' | 'error' | 'stale'

export interface KBDocument {
  id: string
  filename: string
  fileType: 'pdf' | 'docx' | 'xlsx' | 'csv' | 'txt' | 'gdoc' | 'gsheet'
  status: DocumentStatus
  vectorCount: number
  uploadDate: string
  modifiedDate: string
  source: 'manual' | 'drive' | 'api'
  tags: string[]
  sizeBytes: number
}

export interface KBStats {
  vectorCount: number
  documentCount: number
  lastSynced: string
  driveConnected: boolean
  categories?: { name: string; count: number }[]
}

// ── Chat ──────────────────────────────────────────────────────
export type ChatRole = 'user' | 'assistant'
export type MessageStatus = 'streaming' | 'done' | 'error'

export interface ChatSource {
  filename: string
  snippet: string
  score: number
}

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  status: MessageStatus
  confidence?: ConfidenceScore
  sources?: ChatSource[]
  createdAt: string
  feedback?: 'up' | 'down'
}

export interface ChatThread {
  id: string
  title: string
  messages: ChatMessage[]
  createdAt: string
  updatedAt: string
  pinned: boolean
}

// ── Wizard ────────────────────────────────────────────────────
export type WizardStep = 'upload' | 'map' | 'select' | 'generate'

/**
 * Lifecycle of a generation batch. Lives in wizardStore and is driven by
 * stores/generationEngine.ts so it survives navigating away and back.
 */
export type GenerationStatus = 'idle' | 'running' | 'stopping' | 'stopped' | 'completed'

// ── API ───────────────────────────────────────────────────────
export interface AnswerRequest { question: string; section?: string }
export interface AnswerResponse {
  question: string
  section: string
  availability: AvailabilityLabel
  remarks: string
  sources: string[]
  confidence: ConfidenceScore
}

// ── Feedback loop ─────────────────────────────────────────────

export type FeedbackSource = 'workspace' | 'assistant' | 'review_queue' | 'slack'
export type FeedbackSignal = 'thumbs_up' | 'thumbs_down' | 'approved' | 'rejected' | 'edited'

export interface FeedbackPair {
  id: string
  question: string
  section: string
  badAnswer: string           // Original AI-generated answer
  goodAnswer: string          // Corrected answer (edited by human)
  availability: AvailabilityLabel
  confidence: number          // Original confidence score
  signal: FeedbackSignal
  source: FeedbackSource
  actor: string
  createdAt: string
  approved: boolean           // Reviewer approved this pair for training
  usedForTraining: boolean
  notes?: string
}

export interface KnowledgeGap {
  id: string
  question: string
  section: string
  occurrences: number         // How many times this type failed
  avgConfidence: number
  suggestedDocTopic: string
  createdAt: string
  resolved: boolean
}