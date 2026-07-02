import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import type {
  WizardStep,
  WorkbookData,
  ColumnRole,
  ExtractedItem,
  GeneratedResponse,
  ResponseStatus,
  AvailabilityLabel,
  GenerationStatus,
} from '@/types'

interface WizardStore {
  // Step
  step: WizardStep
  setStep: (step: WizardStep) => void

  // Current RFI identity (links wizard state to the history ledger)
  currentRfiId: string | null
  setCurrentRfiId: (id: string | null) => void

  // User-provided display name for this RFP (captured at upload time)
  displayName: string | null
  setDisplayName: (name: string | null) => void

  // Workbook
  workbook: WorkbookData | null
  setWorkbook: (wb: WorkbookData) => void
  activeSheet: string
  setActiveSheet: (name: string) => void
  setColumnRole: (sheetName: string, colIndex: number, role: ColumnRole) => void

  // Extracted items
  items: ExtractedItem[]
  setItems: (items: ExtractedItem[]) => void

  // Selection
  selectedIds: Set<string>
  toggleSelect: (id: string) => void
  selectAll: () => void
  selectIds: (ids: string[]) => void          // select specific ids (e.g. filtered set)
  deselectIds: (ids: Set<string>) => void     // deselect specific ids, keep others
  clearSelection: () => void
  selectByKeyword: (keywords: string[]) => void

  // Responses
  responses: GeneratedResponse[]
  upsertResponse: (r: GeneratedResponse) => void
  removeResponse: (id: string) => void
  updateResponseStatus: (id: string, status: ResponseStatus) => void
  updateResponseEdit: (id: string, remarks: string) => void
  updateResponseAvailability: (id: string, availability: AvailabilityLabel) => void
  // Mirror a Review Queue decision into the active RFI (no-op if the
  // response isn't part of the current run) so exports reflect reviews.
  applyReviewDecision: (id: string, patch: Partial<GeneratedResponse>) => void
  // Mark answered rows as exported (called after a successful export)
  markExported: (ids: string[]) => void
  clearResponses: () => void

  // Generation lifecycle (driven by stores/generationEngine.ts, NOT by components,
  // so progress survives navigating away from the Workspace and back)
  generationStatus: GenerationStatus
  setGenerationStatus: (status: GenerationStatus) => void
  isGenerating: boolean
  generatingId: string | null
  setGenerating: (id: string | null) => void

  // Reset
  reset: () => void
}

const initialState = {
  step: 'upload' as WizardStep,
  currentRfiId: null as string | null,
  displayName: null as string | null,
  workbook: null,
  activeSheet: '',
  items: [],
  selectedIds: new Set<string>(),
  responses: [],
  generationStatus: 'idle' as GenerationStatus,
  isGenerating: false,
  generatingId: null,
}

export const useWizardStore = create<WizardStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      setStep: (step) => set({ step }),

      setCurrentRfiId: (currentRfiId) => set({ currentRfiId }),

      setDisplayName: (displayName) => set({ displayName }),

      setWorkbook: (workbook) => set({
        workbook,
        activeSheet: workbook.sheets[0]?.name ?? '',
      }),

      setActiveSheet: (activeSheet) => set({ activeSheet }),

      setColumnRole: (sheetName, colIndex, role) =>
        set((state) => {
          if (!state.workbook) return state
          const sheets = state.workbook.sheets.map((sheet) => {
            if (sheet.name !== sheetName) return sheet
            const columns = sheet.columns.map((col) => {
              // If setting question role, remove it from any other column first
              if (role === 'question' && col.role === 'question' && col.index !== colIndex) {
                return { ...col, role: 'unassigned' as ColumnRole }
              }
              if (col.index === colIndex) return { ...col, role }
              return col
            })
            return { ...sheet, columns }
          })
          return { workbook: { ...state.workbook, sheets } }
        }),

      setItems: (items) => set({ items }),

      toggleSelect: (id) =>
        set((state) => {
          const next = new Set(state.selectedIds)
          next.has(id) ? next.delete(id) : next.add(id)
          return { selectedIds: next }
        }),

      selectIds: (ids) =>
        set((state) => {
          const next = new Set(state.selectedIds)
          ids.forEach((id) => next.add(id))
          return { selectedIds: next }
        }),

      deselectIds: (ids) =>
        set((state) => {
          const next = new Set(state.selectedIds)
          ids.forEach((id) => next.delete(id))
          return { selectedIds: next }
        }),

      selectAll: () =>
        set((state) => ({
          selectedIds: new Set(state.items.map((i) => i.id)),
        })),

      clearSelection: () => set({ selectedIds: new Set() }),

      selectByKeyword: (keywords) =>
        set((state) => {
          const next = new Set(state.selectedIds)
          state.items.forEach((item) => {
            const q = item.question.toLowerCase()
            if (keywords.some((k) => q.includes(k.toLowerCase()))) {
              next.add(item.id)
            }
          })
          return { selectedIds: next }
        }),

      upsertResponse: (response) =>
        set((state) => {
          const existing = state.responses.findIndex((r) => r.id === response.id)
          if (existing >= 0) {
            const responses = [...state.responses]
            responses[existing] = response
            return { responses }
          }
          return { responses: [...state.responses, response] }
        }),

      removeResponse: (id) =>
        set((state) => ({
          responses: state.responses.filter((r) => r.id !== id),
        })),

      updateResponseStatus: (id, status) =>
        set((state) => ({
          responses: state.responses.map((r) =>
            r.id === id ? { ...r, status } : r
          ),
        })),

      updateResponseEdit: (id, remarks) =>
        set((state) => ({
          responses: state.responses.map((r) =>
            r.id === id ? { ...r, editedRemarks: remarks, status: 'needs_review' } : r
          ),
        })),

      updateResponseAvailability: (id, availability) =>
        set((state) => ({
          responses: state.responses.map((r) =>
            r.id === id ? { ...r, availability, status: 'needs_review' } : r
          ),
        })),

      applyReviewDecision: (id, patch) =>
        set((state) => ({
          responses: state.responses.map((r) =>
            r.id === id ? { ...r, ...patch } : r
          ),
        })),

      markExported: (ids) =>
        set((state) => {
          const idSet = new Set(ids)
          return {
            responses: state.responses.map((r) =>
              idSet.has(r.id) ? { ...r, status: 'exported' as const } : r
            ),
          }
        }),

      // Clearing responses also resets the generation lifecycle so a fresh
      // batch starts cleanly (the engine itself is aborted via resetGeneration()).
      clearResponses: () =>
        set({
          responses: [],
          generationStatus: 'idle',
          isGenerating: false,
          generatingId: null,
        }),

      setGenerationStatus: (generationStatus) => set({ generationStatus }),

      setGenerating: (generatingId) =>
        set({ generatingId, isGenerating: generatingId !== null }),

      reset: () => set({ ...initialState, selectedIds: new Set() }),
    }),
    { name: 'wizard-store' }
  )
)
