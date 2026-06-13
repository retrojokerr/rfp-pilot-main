'use client'

import { motion } from 'framer-motion'
import { Info, ChevronRight, Wand2 } from 'lucide-react'
import { cn } from '@/utils/helpers'
import { useWizardStore } from '@/stores/wizardStore'
import { extractItemsFromSheet } from '@/utils/parser'
import type { ColumnRole, SheetColumn } from '@/types'

const ROLE_CONFIG: Record<ColumnRole, { label: string; color: string; bg: string; border: string; desc: string }> = {
  question:         { label: 'Question',        color: 'text-primary',                             bg: 'bg-primary/10',                           border: 'border-primary/30',                       desc: 'The requirement or question to answer' },
  section:          { label: 'Section',         color: 'text-emerald-600 dark:text-emerald-400',   bg: 'bg-emerald-50 dark:bg-emerald-950/50',     border: 'border-emerald-200 dark:border-emerald-800', desc: 'Category or section grouping' },
  subsection:       { label: 'Subsection',      color: 'text-violet-600 dark:text-violet-400',     bg: 'bg-violet-50 dark:bg-violet-950/50',       border: 'border-violet-200 dark:border-violet-800',   desc: 'Sub-category grouping' },
  availability_out: { label: '→ Yes/No/Partial',color: 'text-orange-600 dark:text-orange-400',     bg: 'bg-orange-50 dark:bg-orange-950/50',       border: 'border-orange-200 dark:border-orange-800',   desc: 'Write generated availability here' },
  remarks_out:      { label: '→ Remarks',       color: 'text-cyan-600 dark:text-cyan-400',         bg: 'bg-cyan-50 dark:bg-cyan-950/50',           border: 'border-cyan-200 dark:border-cyan-800',       desc: 'Write generated answer/remarks here' },
  skip:             { label: 'Skip',            color: 'text-muted-foreground',                    bg: 'bg-muted/50',                             border: 'border-border',                              desc: 'Leave this column untouched' },
  response:         { label: 'Response',        color: 'text-muted-foreground',                    bg: 'bg-muted/50',                             border: 'border-border',                              desc: 'Existing response column' },
  unassigned:       { label: 'Unassigned',      color: 'text-muted-foreground',                    bg: 'bg-muted/20',                             border: 'border-dashed border-border',                desc: 'Not assigned' },
}

type AssignMode = ColumnRole | null

export default function MappingStep() {
  const { workbook, activeSheet, setActiveSheet, setColumnRole, setItems, setStep } = useWizardStore()
  const [assignMode, setAssignMode] = useState<AssignMode>('question')

  const sheet = workbook?.sheets.find((s) => s.name === activeSheet)
  const hasQuestion = sheet?.columns.some((c) => c.role === 'question') ?? false

  function handleColClick(col: SheetColumn) {
    if (!assignMode || !activeSheet) return
    setColumnRole(activeSheet, col.index, col.role === assignMode ? 'unassigned' : assignMode)
  }

  function handleContinue() {
    if (!sheet) return
    const items = extractItemsFromSheet(sheet)
    setItems(items)
    setStep('select')
  }

  if (!workbook) return null

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight mb-1">Map your columns</h2>
        <p className="text-sm text-muted-foreground">
          We've auto-detected column roles. Fix anything that's wrong before continuing.
        </p>
      </div>

      {/* Sheet tabs */}
      {workbook.sheets.length > 1 && (
        <div className="flex gap-2 flex-wrap">
          {workbook.sheets.map((s) => (
            <button
              key={s.name}
              onClick={() => setActiveSheet(s.name)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition-all',
                s.name === activeSheet
                  ? 'bg-primary/10 text-primary border border-primary/30'
                  : 'bg-muted text-muted-foreground hover:text-foreground border border-transparent'
              )}
            >
              {s.name}
              <span className="ml-1.5 text-xs opacity-60">({s.rowCount})</span>
            </button>
          ))}
        </div>
      )}

      {/* Role selector */}
      <div className="flex items-center gap-2 flex-wrap p-3 bg-muted/40 rounded-xl border border-border">
        <span className="text-xs font-medium text-muted-foreground mr-1">Assigning:</span>
        {(['question', 'section', 'subsection', 'availability_out', 'remarks_out', 'skip'] as ColumnRole[]).map((role) => {
          const cfg = ROLE_CONFIG[role]
          return (
            <button
              key={role}
              onClick={() => setAssignMode(assignMode === role ? null : role)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all duration-150',
                assignMode === role
                  ? cn(cfg.color, cfg.bg, cfg.border)
                  : 'text-muted-foreground bg-background border-border hover:border-border/80'
              )}
            >
              {cfg.label}
            </button>
          )
        })}
        <div className="flex items-center gap-1 ml-auto text-xs text-muted-foreground">
          <Info className="w-3.5 h-3.5" />
          <span>Click any column to assign · Mark output columns with → Yes/No/Partial and → Remarks</span>
        </div>
      </div>

      {/* Column cards */}
      {sheet && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {sheet.columns.map((col) => {
            const cfg = ROLE_CONFIG[col.role]
            return (
              <motion.button
                key={col.index}
                onClick={() => handleColClick(col)}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.98 }}
                className={cn(
                  'text-left p-3 rounded-xl border transition-all duration-150 cursor-pointer',
                  cfg.bg, cfg.border
                )}
              >
                <div className="flex items-start justify-between gap-1 mb-2">
                  <span className="text-xs font-semibold text-foreground leading-tight line-clamp-2">
                    {col.name}
                  </span>
                  {col.autoDetected && col.role !== 'unassigned' && (
                    <Wand2 className="w-3 h-3 text-muted-foreground flex-shrink-0 mt-0.5" />
                  )}
                </div>
                <div className="space-y-0.5 mb-2">
                  {col.sample.slice(0, 2).map((s, i) => (
                    <p key={i} className="text-[10px] text-muted-foreground truncate">{s || '—'}</p>
                  ))}
                </div>
                <span className={cn('text-[10px] font-semibold', cfg.color)}>
                  {cfg.label}
                </span>
              </motion.button>
            )
          })}
        </div>
      )}

      {/* Preview table */}
      {sheet && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2 uppercase tracking-wide">Preview (first 8 rows)</p>
          <div className="overflow-x-auto border border-border rounded-xl">
            <table className="w-full text-xs" style={{ tableLayout: 'fixed' }}>
              <thead>
                <tr className="border-b border-border">
                  {sheet.columns.map((col) => {
                    const cfg = ROLE_CONFIG[col.role]
                    return (
                      <th
                        key={col.index}
                        onClick={() => handleColClick(col)}
                        className={cn(
                          'px-3 py-2.5 text-left font-semibold cursor-pointer transition-colors',
                          'whitespace-nowrap overflow-hidden text-ellipsis',
                          col.role === 'question' ? 'bg-primary/8 text-primary' :
                          col.role === 'section'  ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400' :
                          col.role === 'skip'     ? 'bg-muted/50 text-muted-foreground' :
                          'bg-muted/30 text-muted-foreground'
                        )}
                        style={{ maxWidth: 180 }}
                      >
                        {col.name}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {sheet.rows.slice(0, 8).map((row, ri) => (
                  <tr key={ri} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                    {sheet.columns.map((col) => {
                      const val = row[col.name] ?? ''
                      return (
                        <td
                          key={col.index}
                          className={cn(
                            'px-3 py-2 text-[11px] overflow-hidden',
                            col.role === 'question' ? 'text-foreground font-medium' : 'text-muted-foreground',
                            col.role === 'skip' && 'opacity-40',
                          )}
                          style={{ maxWidth: 180, whiteSpace: col.role === 'question' ? 'normal' : 'nowrap', textOverflow: 'ellipsis' }}
                          title={val}
                        >
                          {val || '—'}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-2">
        <button
          onClick={() => setStep('upload')}
          className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Back
        </button>
        <button
          onClick={handleContinue}
          disabled={!hasQuestion}
          className={cn(
            'flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all',
            hasQuestion
              ? 'bg-primary text-primary-foreground hover:opacity-90'
              : 'bg-muted text-muted-foreground cursor-not-allowed'
          )}
        >
          Select questions
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

import { useState } from 'react'