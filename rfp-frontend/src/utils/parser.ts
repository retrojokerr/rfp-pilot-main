import * as XLSX from 'xlsx'
import type { WorkbookData, SheetData, SheetColumn, ColumnRole } from '@/types'

const QUESTION_KEYWORDS = [
  'requirement', 'description', 'question', 'use case', 'feature',
  'capability', 'item', 'criteria', 'particulars', 'check', 'scope',
  'action', 'activity', 'deliverable', 'functionality', 'specification',
]
const SECTION_KEYWORDS = [
  'category', 'section', 'area', 'domain', 'module', 'group', 'phase',
]
const SUBSECTION_KEYWORDS = [
  'sub-category', 'subcategory', 'sub category', 'sub-section', 'type',
]
const AVAIL_OUT_KEYWORDS = [
  'availability', 'available', 'yes/no', 'yes / no', 'compliant',
  'compliance status', 'matters response', 'vendor response',
]
const REMARKS_OUT_KEYWORDS = [
  'remarks', 'comment', 'notes', 'explanation',
  'description of response', 'vendor remarks', 'matters remarks',
]
const SKIP_KEYWORDS = [
  'score', 'marks', 'points', 'weightage', 'owner', 'date',
  'eta', 'reference', 'attachment', 'evidence',
]

function detectRole(header: string): { role: ColumnRole; autoDetected: boolean } {
  const h = header.toLowerCase().trim()
  if (SKIP_KEYWORDS.some((k) => h.includes(k))) return { role: 'skip', autoDetected: true }
  if (AVAIL_OUT_KEYWORDS.some((k) => h === k || h.includes(k))) return { role: 'availability_out', autoDetected: true }
  if (REMARKS_OUT_KEYWORDS.some((k) => h === k || h.includes(k))) return { role: 'remarks_out', autoDetected: true }
  if (SUBSECTION_KEYWORDS.some((k) => h.includes(k))) return { role: 'subsection', autoDetected: true }
  if (SECTION_KEYWORDS.some((k) => h.includes(k))) return { role: 'section', autoDetected: true }
  if (QUESTION_KEYWORDS.some((k) => h.includes(k))) return { role: 'question', autoDetected: true }
  return { role: 'unassigned', autoDetected: false }
}

function findHeaderRow(raw: unknown[][]): number {
  for (let i = 0; i < Math.min(8, raw.length); i++) {
    const nonEmpty = raw[i].filter((c) => String(c ?? '').trim()).length
    if (nonEmpty >= 2) return i
  }
  return 0
}

function parseSheet(ws: XLSX.WorkSheet, name: string): SheetData {
  const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' })
  if (!raw.length) return { name, columns: [], rows: [], rowCount: 0 }

  const headerRowIdx = findHeaderRow(raw)
  const headerRow = raw[headerRowIdx] as string[]
  const dataRows = raw.slice(headerRowIdx + 1).filter((r) =>
    (r as string[]).some((c) => String(c ?? '').trim())
  )

  // Detect question column: prefer header keyword match, else longest avg content
  let questionColIdx = -1
  const colAvgLen: number[] = headerRow.map((_, ci) => {
    const vals = dataRows.slice(0, 10).map((r) => String((r as string[])[ci] ?? ''))
    return vals.reduce((s, v) => s + v.length, 0) / 10
  })

  const columns: SheetColumn[] = headerRow.map((h, i) => {
    const header = String(h ?? '').trim() || `Col ${i + 1}`
    const { role, autoDetected } = detectRole(header)
    const sample = dataRows
      .slice(0, 4)
      .map((r) => String((r as string[])[i] ?? '').slice(0, 60))
      .filter(Boolean)
    return { index: i, name: header, role, sample, autoDetected }
  })

  // Assign question column if none detected by keyword
  if (!columns.some((c) => c.role === 'question')) {
    const bestCol = columns
      .filter((c) => c.role === 'unassigned')
      .sort((a, b) => colAvgLen[b.index] - colAvgLen[a.index])[0]
    if (bestCol) {
      columns[bestCol.index].role = 'question'
      columns[bestCol.index].autoDetected = true
      questionColIdx = bestCol.index
    }
  } else {
    questionColIdx = columns.findIndex((c) => c.role === 'question')
  }

  const rows = dataRows.map((r) => {
    const row: Record<string, string> = {}
    headerRow.forEach((h, i) => {
      row[String(h ?? '') || `col_${i}`] = String((r as string[])[i] ?? '').trim()
    })
    return row
  }).filter((r) => {
    const qCol = headerRow[questionColIdx]
    return qCol ? (r[qCol]?.length ?? 0) > 4 : Object.values(r).some((v) => v.length > 4)
  })

  return { name, columns, rows, rowCount: rows.length }
}

export function parseWorkbook(buffer: ArrayBuffer, filename: string): WorkbookData {
  const wb = XLSX.read(buffer, { type: 'array' })

  const sheets: SheetData[] = wb.SheetNames
    .map((name) => {
      const ws = wb.Sheets[name]
      return parseSheet(ws, name)
    })
    .filter((s) => s.rowCount > 0) // skip empty sheets

  // Default to first sheet with meaningful data (>2 rows)
  const defaultSheet =
    sheets.find((s) => s.rowCount > 2)?.name ?? sheets[0]?.name ?? ''

  return { filename, sheets, activeSheet: defaultSheet }
}

export function extractItemsFromSheet(sheet: SheetData): import('@/types').ExtractedItem[] {
  const qCol = sheet.columns.find((c) => c.role === 'question')
  const sCol = sheet.columns.find((c) => c.role === 'section')
  const ssCol = sheet.columns.find((c) => c.role === 'subsection')

  if (!qCol) return []

  return sheet.rows
    .map((row, i) => {
      const question = row[qCol.name]?.trim() ?? ''
      if (!question || question.length < 5) return null

      const section = sCol ? (row[sCol.name]?.trim() ?? '') : sheet.name
      const subsection = ssCol ? (row[ssCol.name]?.trim() ?? '') : ''

      return {
        id: `${sheet.name}-${i}`,
        section,
        subsection,
        question,
        itemType: classifyType(question),
        priority: classifyPriority(question),
        sourceRow: i,
        rawText: question,
      } as import('@/types').ExtractedItem
    })
    .filter((item): item is import('@/types').ExtractedItem => item !== null)
}

function classifyType(text: string): import('@/types').ItemType {
  const t = text.toLowerCase()
  if (/\?$/.test(t) || /^(does|do|is|are|can|will)\b/.test(t)) return 'question'
  if (/(mandatory|shall|must|compliance|regulatory)/.test(t)) return 'compliance'
  if (/^(configure|enable|implement|verify|validate|ensure|deploy)\b/.test(t)) return 'action_item'
  if (/(use case|use-case|scenario|user story)/.test(t)) return 'use_case'
  return 'requirement'
}

function classifyPriority(text: string): import('@/types').Priority {
  const t = text.toLowerCase()
  const high = ['mandatory', 'critical', 'required', 'must', 'security', 'encryption',
    'authentication', 'dlp', 'gdpr', 'sebi', 'rbi', 'compliance']
  const low = ['should', 'preferred', 'desirable', 'optional']
  if (high.some((k) => t.includes(k))) return 'high'
  if (low.some((k) => t.includes(k))) return 'low'
  return 'medium'
}