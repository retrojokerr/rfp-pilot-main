/**
 * exporter.ts — Write generated answers back into the original uploaded workbook.
 *
 * Strategy:
 * 1. Re-read the original ArrayBuffer with SheetJS
 * 2. Find the active sheet
 * 3. Re-detect the header row to find availability_out and remarks_out column indices
 * 4. For each generated response, find its matching row by question text
 * 5. Write availability and remarks into those cells only
 * 6. Leave every other cell, formula, format, and sheet untouched
 * 7. Trigger browser download
 */

import * as XLSX from 'xlsx'
import type { GeneratedResponse, SheetData, WorkbookData } from '@/types'
import { getRawBuffer } from '@/stores/bufferStore'

/** Normalise a user-chosen export name: trim, strip path chars, force .xlsx */
function ensureXlsx(name?: string): string | null {
  if (!name) return null
  const clean = name.trim().replace(/[\\/:*?"<>|]/g, '').replace(/\.(xlsx?|csv)$/i, '')
  return clean ? `${clean}.xlsx` : null
}

interface ExportOptions {
  workbook: WorkbookData
  responses: GeneratedResponse[]
  includeConfidence?: boolean
  /** User-chosen output name from the export dialog (extension optional) */
  filename?: string
}

export function exportToOriginalWorkbook({
  workbook,
  responses,
  filename,
  includeConfidence = true,
}: ExportOptions): void {
  const rawBuffer = getRawBuffer()
  if (!rawBuffer) {
    throw new Error('Original workbook buffer not found. Please re-upload the file.')
  }

  // 1. Parse the original workbook from the stored buffer
  const wb = XLSX.read(rawBuffer, { type: 'array', cellStyles: true })

  // 2. Find the sheet that has output columns mapped (prefer this over active sheet)
  const mappedSheet = workbook.sheets.find((s) =>
    s.columns.some((c) => c.role === 'availability_out' || c.role === 'remarks_out')
  )
  const sheet = mappedSheet ?? workbook.sheets.find((s) => s.name === workbook.activeSheet) ?? workbook.sheets[0]
  if (!sheet) throw new Error('No sheet found in workbook.')

  const sheetName = sheet.name
  const ws = wb.Sheets[sheetName]
  if (!ws) throw new Error(`Sheet "${sheetName}" not found in workbook.`)

  // 3. Get sheet dimensions
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')

  const questionCol = sheet.columns.find((c) => c.role === 'question')
  const availCol    = sheet.columns.find((c) => c.role === 'availability_out')
  const remarksCol  = sheet.columns.find((c) => c.role === 'remarks_out')

  if (!availCol && !remarksCol) {
    // Debug: show what roles we DO have
    const rolesSummary = sheet.columns
      .filter(c => c.role !== 'unassigned' && c.role !== 'skip')
      .map(c => `${c.name}: ${c.role}`)
      .join(', ')

    throw new Error(
      `No output columns mapped on sheet "${sheetName}". Current roles: [${rolesSummary || 'none assigned'}]. Go back to "Map columns" and assign at least one column as "→ Yes/No/Partial" (orange) or "→ Remarks" (cyan).`
    )
  }

  // 5. Find the header row index by looking for the question column header
  let headerRowIdx = 0
  if (questionCol) {
    for (let r = range.s.r; r <= Math.min(range.s.r + 7, range.e.r); r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c: questionCol.index })]
      if (cell && String(cell.v ?? '').toLowerCase().trim() === questionCol.name.toLowerCase().trim()) {
        headerRowIdx = r
        break
      }
    }
  }

  const dataStartRow = headerRowIdx + 1

  // 6. Build a lookup: normalised question text → response
  const responseMap = new Map<string, GeneratedResponse>()
  responses.forEach((r) => {
    responseMap.set(normalise(r.question), r)
  })

  // 7. Walk each data row and inject answers
  let injected = 0
  for (let r = dataStartRow; r <= range.e.r; r++) {
    // Get question text from this row
    let questionText = ''
    if (questionCol) {
      const qCell = ws[XLSX.utils.encode_cell({ r, c: questionCol.index })]
      questionText = String(qCell?.v ?? '').trim()
    }

    const response = responseMap.get(normalise(questionText))
    if (!response) continue

    const finalRemarks = response.editedRemarks ?? response.remarks

    // Write availability (Yes/No/Partial)
    if (availCol) {
      const addr = XLSX.utils.encode_cell({ r, c: availCol.index })
      ws[addr] = {
        t: 's',
        v: response.availability,
        // Preserve any existing cell style if present
        ...(ws[addr]?.s ? { s: ws[addr].s } : {}),
      }
    }

    // Write remarks
    if (remarksCol) {
      const addr = XLSX.utils.encode_cell({ r, c: remarksCol.index })
      ws[addr] = {
        t: 's',
        v: finalRemarks,
        ...(ws[addr]?.s ? { s: ws[addr].s } : {}),
      }
    }

    // Optionally write confidence score in a new column or adjacent cell
    if (includeConfidence) {
      // Find if there's a column named "Confidence" or similar — if not, skip
      const confCol = sheet.columns.find((c) =>
        c.name.toLowerCase().includes('confidence') || c.name.toLowerCase().includes('score')
      )
      if (confCol) {
        const addr = XLSX.utils.encode_cell({ r, c: confCol.index })
        ws[addr] = { t: 'n', v: Math.round(response.confidence.score * 100) / 100 }
      }
    }

    injected++
  }

  if (injected === 0) {
    throw new Error(
      'No rows matched. Make sure the question column is correctly mapped and answers were generated for this sheet.'
    )
  }

  // 8. Download — preserving all other sheets, formats, and data
  const outputFilename = ensureXlsx(filename) ?? workbook.filename.replace(/\.(xlsx?|csv)$/i, '_responses.xlsx')
  XLSX.writeFile(wb, outputFilename)
}

/** Normalise question text for fuzzy matching — lowercase, collapse whitespace */
function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200)
}


/**
 * exportSheetAsNewWorkbook — Export the entire active sheet (all rows + all columns)
 * as a brand new standalone Excel file, with the generated responses injected
 * into the mapped output columns.
 *
 * Unlike exportToOriginalWorkbook, this:
 * - Creates a fresh workbook with just ONE sheet (the active one)
 * - Preserves all original columns and rows
 * - Writes responses into availability_out and remarks_out columns
 * - Does NOT preserve formulas/styles (those need the original file)
 * - Does NOT include other sheets like "Cover & Summary"
 *
 * Use this when you want a clean deliverable file with just the answered sheet.
 */
export function exportSheetAsNewWorkbook({
  workbook,
  responses,
  filename,
}: ExportOptions): void {
  // Find the sheet with output mappings (or use active sheet)
  const mappedSheet = workbook.sheets.find((s) =>
    s.columns.some((c) => c.role === 'availability_out' || c.role === 'remarks_out')
  )
  const sheet =
    mappedSheet ??
    workbook.sheets.find((s) => s.name === workbook.activeSheet) ??
    workbook.sheets[0]

  if (!sheet) throw new Error('No sheet found in workbook.')

  const questionCol = sheet.columns.find((c) => c.role === 'question')
  const availCol = sheet.columns.find((c) => c.role === 'availability_out')
  const remarksCol = sheet.columns.find((c) => c.role === 'remarks_out')

  if (!availCol && !remarksCol) {
    throw new Error(
      `No output columns mapped on sheet "${sheet.name}". Assign at least one column as "→ Yes/No/Partial" or "→ Remarks".`
    )
  }
  if (!questionCol) {
    throw new Error('No question column mapped. Map the question column first.')
  }

  // Build a lookup: normalised question text → response
  const responseMap = new Map<string, GeneratedResponse>()
  responses.forEach((r) => {
    responseMap.set(normalise(r.question), r)
  })

  // Build a 2D array: headers row + all data rows with answers injected
  const headers = sheet.columns.map((c) => c.name)
  const dataRows = sheet.rows.map((row) => {
    const question = row[questionCol.name] ?? ''
    const response = responseMap.get(normalise(question))
    const finalRemarks = response?.editedRemarks ?? response?.remarks ?? ''

    return sheet.columns.map((col) => {
      // Inject availability into availability_out column
      if (availCol && col.index === availCol.index && response) {
        return response.availability
      }
      // Inject remarks into remarks_out column
      if (remarksCol && col.index === remarksCol.index && response) {
        return finalRemarks
      }
      // Otherwise keep original cell value
      return row[col.name] ?? ''
    })
  })

  // Build the new workbook
  const wb = XLSX.utils.book_new()
  const wsData = [headers, ...dataRows]
  const ws = XLSX.utils.aoa_to_sheet(wsData)

  // Set reasonable column widths
  ws['!cols'] = sheet.columns.map((col) => {
    if (col.role === 'question') return { wch: 60 }
    if (col.role === 'remarks_out') return { wch: 80 }
    if (col.role === 'availability_out') return { wch: 15 }
    if (col.role === 'section' || col.role === 'subsection') return { wch: 25 }
    return { wch: 20 }
  })

  // Style the header row (bold)
  const headerRange = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
  for (let c = headerRange.s.c; c <= headerRange.e.c; c++) {
    const cellAddr = XLSX.utils.encode_cell({ r: 0, c })
    if (ws[cellAddr]) {
      ws[cellAddr].s = {
        font: { bold: true },
        fill: { fgColor: { rgb: 'E5E7EB' } },
      }
    }
  }

  XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31)) // Excel sheet name limit

  const outputFilename =
    ensureXlsx(filename) ?? (workbook.filename.replace(/\.(xlsx?|csv)$/i, '') + `_${sheet.name}_responses.xlsx`)

  XLSX.writeFile(wb, outputFilename)
}