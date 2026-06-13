'use client'

import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  useReactTable, getCoreRowModel, getFilteredRowModel,
  flexRender, type ColumnDef,
} from '@tanstack/react-table'
import { Search, Shield, X, ChevronRight, Filter } from 'lucide-react'
import { cn, itemTypeLabel, priorityConfig, SECURITY_KEYWORDS } from '@/utils/helpers'
import { useWizardStore } from '@/stores/wizardStore'
import type { ExtractedItem } from '@/types'

export default function SelectStep() {
  const { items, selectedIds, toggleSelect, selectAll, clearSelection, selectByKeyword, setStep } = useWizardStore()
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('all')

  const filtered = useMemo(() => {
    let result = items
    if (search) {
      const q = search.toLowerCase()
      result = result.filter((i) =>
        i.question.toLowerCase().includes(q) ||
        i.section.toLowerCase().includes(q)
      )
    }
    if (typeFilter !== 'all') {
      result = result.filter((i) => i.itemType === typeFilter)
    }
    return result
  }, [items, search, typeFilter])

  const allSelected = filtered.length > 0 && filtered.every((i) => selectedIds.has(i.id))
  const someSelected = filtered.some((i) => selectedIds.has(i.id))

  const columns: ColumnDef<ExtractedItem>[] = [
    {
      id: 'select',
      size: 40,
      header: () => (
        <input
          type="checkbox"
          checked={allSelected}
          ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected }}
          onChange={(e) => {
            if (e.target.checked) {
              // Select only the FILTERED rows, not the entire sheet.
              // selectAll() would ignore active search/type filters.
              filtered.forEach((i) => toggleSelect(i.id))
              // But toggleSelect is a toggle — only add unselected ones.
              // Rewrite as a direct set via the store.
              const ids = filtered.map((i) => i.id)
              useWizardStore.getState().selectIds(ids)
            } else {
              // Deselect only the filtered rows, keep selections outside the filter.
              const ids = new Set(filtered.map((i) => i.id))
              useWizardStore.getState().deselectIds(ids)
            }
          }}
          className="w-4 h-4 rounded border-border accent-primary cursor-pointer"
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={selectedIds.has(row.original.id)}
          onChange={() => toggleSelect(row.original.id)}
          className="w-4 h-4 rounded border-border accent-primary cursor-pointer"
        />
      ),
    },
    {
      accessorKey: 'section',
      header: 'Section',
      size: 140,
      cell: ({ getValue }) => (
        <span className="text-xs text-muted-foreground truncate block max-w-[130px]" title={getValue() as string}>
          {getValue() as string || '—'}
        </span>
      ),
    },
    {
      accessorKey: 'question',
      header: 'Question / Requirement',
      cell: ({ row }) => (
        <div className="space-y-1 py-0.5">
          <p className="text-sm text-foreground leading-snug line-clamp-2">
            {row.original.question}
          </p>
          <div className="flex items-center gap-1.5">
            <span className={cn(
              'text-[10px] font-semibold px-1.5 py-0.5 rounded',
              priorityConfig(row.original.priority).color,
              priorityConfig(row.original.priority).bg
            )}>
              {priorityConfig(row.original.priority).label}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {itemTypeLabel(row.original.itemType)}
            </span>
          </div>
        </div>
      ),
    },
  ]

  const table = useReactTable({
    data: filtered,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  const types = useMemo(() => {
    const counts: Record<string, number> = {}
    items.forEach((i) => { counts[i.itemType] = (counts[i.itemType] ?? 0) + 1 })
    return counts
  }, [items])

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight mb-1">Select questions to answer</h2>
          <p className="text-sm text-muted-foreground">
            {items.length} requirements extracted · {selectedIds.size} selected
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => selectByKeyword(SECURITY_KEYWORDS)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors"
          >
            <Shield className="w-3 h-3" />
            Security / compliance
          </button>
          {selectedIds.size > 0 && (
            <button
              onClick={clearSelection}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-3 h-3" />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search requirements..."
            className="w-full pl-9 pr-4 py-2 text-sm bg-muted/40 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 transition-all"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-muted-foreground" />
          {['all', ...Object.keys(types)].map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={cn(
                'px-2.5 py-1 rounded-lg text-xs font-medium transition-all',
                typeFilter === t
                  ? 'bg-primary/10 text-primary border border-primary/30'
                  : 'text-muted-foreground hover:text-foreground border border-transparent'
              )}
            >
              {t === 'all' ? `All (${items.length})` : `${itemTypeLabel(t)} (${types[t]})`}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="border border-border rounded-xl overflow-hidden">
        <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id} className="bg-muted/60 border-b border-border">
                  {hg.headers.map((header) => (
                    <th
                      key={header.id}
                      style={{ width: header.getSize() }}
                      className="px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground"
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row, i) => (
                <motion.tr
                  key={row.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: Math.min(i * 0.02, 0.3) }}
                  className={cn(
                    'border-b border-border/50 transition-colors cursor-pointer',
                    selectedIds.has(row.original.id)
                      ? 'bg-primary/5 hover:bg-primary/8'
                      : 'hover:bg-muted/30'
                  )}
                  onClick={() => toggleSelect(row.original.id)}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="px-3 py-2"
                      onClick={(e) => {
                        if (cell.column.id === 'select') e.stopPropagation()
                      }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </motion.tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-8 text-center text-sm text-muted-foreground">
                    No requirements match your search.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => setStep('map')}
          className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          ← Back
        </button>
        <button
          onClick={() => setStep('generate')}
          disabled={selectedIds.size === 0}
          className={cn(
            'flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all',
            selectedIds.size > 0
              ? 'bg-primary text-primary-foreground hover:opacity-90'
              : 'bg-muted text-muted-foreground cursor-not-allowed'
          )}
        >
          Generate {selectedIds.size > 0 && `${selectedIds.size} answers`}
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}