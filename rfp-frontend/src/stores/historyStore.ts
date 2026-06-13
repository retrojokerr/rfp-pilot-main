import { create } from 'zustand'
import {
  fetchHistoryEntries,
  upsertHistoryEntry,
  deleteHistoryEntry,
} from '@/services/api'

/**
 * historyStore — one entry per uploaded RFI workbook.
 *
 * SERVER-BACKED (org-wide): the ledger lives on the backend (/history),
 * so every user with access sees the same list, regardless of browser.
 * Local state is an optimistic cache — actions update it immediately and
 * sync to the server fire-and-forget (the page also loads fresh on mount).
 */

export interface RfiHistoryEntry {
  id: string
  filename: string          // original uploaded file name
  uploadedAt: string
  sheetCount: number
  totalQuestions: number
  selectedCount: number
  answered: number
  needsReview: number
  approved: number
  errors: number
  avgConfidence: number
  exportedAt?: string
  exportedAs?: string
  status: 'in_progress' | 'generated' | 'exported'
  owner?: string            // stamped by the server on create
  ownerName?: string
}

interface HistoryStore {
  entries: RfiHistoryEntry[]
  loading: boolean
  load: () => Promise<void>
  startEntry: (e: Pick<RfiHistoryEntry, 'id' | 'filename' | 'sheetCount' | 'totalQuestions'>) => void
  updateEntry: (id: string, patch: Partial<RfiHistoryEntry>) => void
  removeEntry: (id: string) => void
}

export const useHistoryStore = create<HistoryStore>()((set, get) => ({
  entries: [],
  loading: false,

  load: async () => {
    set({ loading: true })
    try {
      const entries = await fetchHistoryEntries<RfiHistoryEntry>()
      set({ entries })
    } catch {
      // Keep the optimistic cache if the server is unreachable
    } finally {
      set({ loading: false })
    }
  },

  startEntry: ({ id, filename, sheetCount, totalQuestions }) => {
    const entry: RfiHistoryEntry = {
      id,
      filename,
      uploadedAt: new Date().toISOString(),
      sheetCount,
      totalQuestions,
      selectedCount: 0,
      answered: 0,
      needsReview: 0,
      approved: 0,
      errors: 0,
      avgConfidence: 0,
      status: 'in_progress',
    }
    set((s) => ({ entries: [entry, ...s.entries].slice(0, 200) }))
    upsertHistoryEntry(entry).catch(() => { /* synced on next update */ })
  },

  updateEntry: (id, patch) => {
    set((s) => ({
      entries: s.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }))
    const merged = get().entries.find((e) => e.id === id)
    if (merged) upsertHistoryEntry(merged).catch(() => { /* retried on next update */ })
  },

  removeEntry: (id) => {
    set((s) => ({ entries: s.entries.filter((e) => e.id !== id) }))
    deleteHistoryEntry(id).catch(() => { /* 403 → owner/admin only; reload shows truth */ })
  },
}))
