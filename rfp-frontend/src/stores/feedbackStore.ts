import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { FeedbackPair, FeedbackSignal, FeedbackSource, KnowledgeGap, AvailabilityLabel } from '@/types'

function makeId() { return Math.random().toString(36).slice(2, 10) }
function now() { return new Date().toISOString() }
const ACTOR = 'Subandhu'

interface FeedbackStore {
  pairs: FeedbackPair[]
  gaps: KnowledgeGap[]

  // Capture feedback
  capture: (params: {
    question: string
    section: string
    badAnswer: string
    goodAnswer: string
    availability: AvailabilityLabel
    confidence: number
    signal: FeedbackSignal
    source: FeedbackSource
    notes?: string
  }) => string

  // Approve/reject pairs for training
  approvePair: (id: string) => void
  rejectPair: (id: string) => void
  markUsedForTraining: (id: string) => void

  // Knowledge gaps
  addGap: (question: string, section: string, confidence: number) => void
  resolveGap: (id: string) => void

  // Export
  exportAsJSONL: () => string
  exportAsCSV: () => string

  // Stats
  getStats: () => {
    total: number
    approved: number
    pending: number
    usedForTraining: number
    bySource: Record<FeedbackSource, number>
    bySignal: Record<FeedbackSignal, number>
    avgConfidenceImprovement: number
  }

  clear: () => void
}

export const useFeedbackStore = create<FeedbackStore>()(
  persist(
    (set, get) => ({
      pairs: [],
      gaps: [],

      capture: ({ question, section, badAnswer, goodAnswer, availability, confidence, signal, source, notes }) => {
        const id = makeId()
        const pair: FeedbackPair = {
          id, question, section, badAnswer, goodAnswer,
          availability, confidence, signal, source,
          actor: ACTOR, createdAt: now(),
          approved: signal === 'approved' || signal === 'thumbs_up',
          usedForTraining: false,
          notes,
        }
        set((s) => ({ pairs: [pair, ...s.pairs] }))

        // Auto-detect knowledge gaps: low confidence + negative signal
        if (confidence < 0.7 && (signal === 'thumbs_down' || signal === 'rejected')) {
          get().addGap(question, section, confidence)
        }

        return id
      },

      approvePair: (id) =>
        set((s) => ({
          pairs: s.pairs.map((p) => p.id === id ? { ...p, approved: true } : p),
        })),

      rejectPair: (id) =>
        set((s) => ({
          pairs: s.pairs.filter((p) => p.id !== id),
        })),

      markUsedForTraining: (id) =>
        set((s) => ({
          pairs: s.pairs.map((p) => p.id === id ? { ...p, usedForTraining: true } : p),
        })),

      addGap: (question, section, confidence) => {
        set((s) => {
          // Check if similar gap already exists
          const existing = s.gaps.find((g) =>
            !g.resolved &&
            g.question.toLowerCase().slice(0, 40) === question.toLowerCase().slice(0, 40)
          )
          if (existing) {
            return {
              gaps: s.gaps.map((g) => g.id === existing.id
                ? { ...g, occurrences: g.occurrences + 1, avgConfidence: (g.avgConfidence + confidence) / 2 }
                : g
              ),
            }
          }
          const gap: KnowledgeGap = {
            id: makeId(),
            question,
            section,
            occurrences: 1,
            avgConfidence: confidence,
            suggestedDocTopic: inferDocTopic(question),
            createdAt: now(),
            resolved: false,
          }
          return { gaps: [gap, ...s.gaps] }
        })
      },

      resolveGap: (id) =>
        set((s) => ({
          gaps: s.gaps.map((g) => g.id === id ? { ...g, resolved: true } : g),
        })),

      exportAsJSONL: () => {
        // OpenAI/Groq fine-tuning format
        const approved = get().pairs.filter((p) => p.approved)
        return approved.map((p) => JSON.stringify({
          messages: [
            { role: 'system', content: 'You are an enterprise RFP/RFI response assistant. Answer clearly and factually.' },
            { role: 'user', content: p.question },
            { role: 'assistant', content: `AVAILABILITY: ${p.availability}\nREMARKS: ${p.goodAnswer}` },
          ],
        })).join('\n')
      },

      exportAsCSV: () => {
        const headers = ['question', 'section', 'bad_answer', 'good_answer', 'availability', 'confidence', 'signal', 'source', 'created_at']
        const rows = get().pairs.filter((p) => p.approved).map((p) => [
          `"${p.question.replace(/"/g, '""')}"`,
          `"${p.section.replace(/"/g, '""')}"`,
          `"${p.badAnswer.replace(/"/g, '""')}"`,
          `"${p.goodAnswer.replace(/"/g, '""')}"`,
          p.availability,
          p.confidence,
          p.signal,
          p.source,
          p.createdAt,
        ].join(','))
        return [headers.join(','), ...rows].join('\n')
      },

      getStats: () => {
        const { pairs } = get()
        const bySource = { workspace: 0, assistant: 0, review_queue: 0 } as Record<string, number>
        const bySignal = { thumbs_up: 0, thumbs_down: 0, approved: 0, rejected: 0, edited: 0 } as Record<string, number>
        pairs.forEach((p) => {
          bySource[p.source] = (bySource[p.source] ?? 0) + 1
          bySignal[p.signal] = (bySignal[p.signal] ?? 0) + 1
        })
        const editedPairs = pairs.filter((p) => p.goodAnswer !== p.badAnswer)
        const avgImprovement = editedPairs.length > 0
          ? editedPairs.reduce((s, p) => s + (1 - p.confidence), 0) / editedPairs.length
          : 0

        return {
          total: pairs.length,
          approved: pairs.filter((p) => p.approved).length,
          pending: pairs.filter((p) => !p.approved).length,
          usedForTraining: pairs.filter((p) => p.usedForTraining).length,
          bySource: bySource as Record<FeedbackSource, number>,
          bySignal: bySignal as Record<FeedbackSignal, number>,
          avgConfidenceImprovement: Math.round(avgImprovement * 100),
        }
      },

      clear: () => set({ pairs: [], gaps: [] }),
    }),
    { name: 'rfp-feedback-store' }
  )
)

function inferDocTopic(question: string): string {
  const q = question.toLowerCase()
  if (q.includes('dlp') || q.includes('data loss')) return 'DLP capabilities documentation'
  if (q.includes('classif')) return 'Data classification documentation'
  if (q.includes('encrypt')) return 'Encryption & security documentation'
  if (q.includes('cloud') || q.includes('aws') || q.includes('azure')) return 'Cloud deployment documentation'
  if (q.includes('integrat') || q.includes('siem') || q.includes('api')) return 'Integration guides'
  if (q.includes('compli') || q.includes('gdpr') || q.includes('sebi')) return 'Compliance & regulatory documentation'
  if (q.includes('discover')) return 'Data discovery documentation'
  if (q.includes('user') || q.includes('access') || q.includes('auth')) return 'Access control documentation'
  return 'General product documentation'
}