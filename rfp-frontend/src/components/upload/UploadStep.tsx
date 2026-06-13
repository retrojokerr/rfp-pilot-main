'use client'

import { useCallback, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { motion, AnimatePresence } from 'framer-motion'
import { Upload, FileSpreadsheet, AlertCircle, CheckCircle2, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/utils/helpers'
import { useWizardStore } from '@/stores/wizardStore'
import { resetGeneration } from '@/stores/generationEngine'
import { useHistoryStore } from '@/stores/historyStore'
import { parseWorkbook, extractItemsFromSheet } from '@/utils/parser'
import { setRawBuffer as saveBuffer } from '@/stores/bufferStore'

const SAMPLE_DATA = [
  ['Category', 'Sub-Category', 'Requirement Description', 'Matters Response', 'Remarks'],
  ['Data Classification', 'Scheme & Labels', 'Support a multi-level classification taxonomy (Public, Internal, Confidential, Restricted)', '', ''],
  ['Data Classification', 'Auto-Classification', 'Automatically classify data based on content inspection and ML models', '', ''],
  ['DLP', 'Real-time Monitoring', 'Provide real-time monitoring of data flows across all repositories', '', ''],
  ['DLP', 'Policy Enforcement', 'Support custom DLP policies with automated remediation actions', '', ''],
  ['Security', 'Encryption', 'All data at rest must be encrypted using AES-256', '', ''],
  ['Security', 'Authentication', 'Support SSO via SAML 2.0 and OAuth 2.0', '', ''],
  ['Compliance', 'SEBI', 'Demonstrate compliance with SEBI circular on data governance', '', ''],
  ['Compliance', 'DPDP', 'Support for India Digital Personal Data Protection Act requirements', '', ''],
  ['Integration', 'SIEM', 'Integrate with Splunk, QRadar, and Microsoft Sentinel', '', ''],
  ['Integration', 'Cloud', 'Support deployment on AWS, Azure, and GCP', '', ''],
]

export default function UploadStep() {
  const { setWorkbook, setItems, setStep, clearResponses, clearSelection } = useWizardStore()
  const [status, setStatus] = useState<'idle' | 'parsing' | 'done' | 'error'>('idle')
  const [filename, setFilename] = useState('')
  const [error, setError] = useState('')

  const processFile = useCallback(async (buffer: ArrayBuffer, name: string) => {
    setStatus('parsing')
    setFilename(name)
    setError('')
    // Reset previous state so we don't carry over old responses.
    // resetGeneration() also ABORTS any batch still running in the
    // background from a previous RFI, so the engine never writes stale
    // answers into the new workbook's state.
    resetGeneration()
    clearResponses()
    clearSelection()

    try {
      await new Promise((r) => setTimeout(r, 400)) // Brief UX delay
      const workbook = parseWorkbook(buffer, name)
      saveBuffer(buffer)

      if (!workbook.sheets.length) {
        throw new Error('No readable sheets found in this file.')
      }

      setWorkbook(workbook)

      // Extract items from active sheet
      const activeSheet = workbook.sheets.find((s) => s.name === workbook.activeSheet)
      if (activeSheet) {
        const items = extractItemsFromSheet(activeSheet)
        setItems(items)
        // Record this RFI in the history ledger with its ORIGINAL filename
        const rfiId = Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
        useWizardStore.getState().setCurrentRfiId(rfiId)
        useHistoryStore.getState().startEntry({
          id: rfiId,
          filename: name,
          sheetCount: workbook.sheets.length,
          totalQuestions: items.length,
        })
      }

      setStatus('done')
      toast.success(`Parsed ${workbook.sheets.length} sheet(s)`, {
        description: `Ready to map columns`,
      })

      setTimeout(() => setStep('map'), 600)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to parse file'
      setError(msg)
      setStatus('error')
      toast.error('Failed to parse file', { description: msg })
    }
  }, [setWorkbook, setItems, setStep, clearResponses, clearSelection])

  const onDrop = useCallback((accepted: File[]) => {
    const file = accepted[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (e) => processFile(e.target!.result as ArrayBuffer, file.name)
    reader.readAsArrayBuffer(file)
  }, [processFile])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
      'text/csv': ['.csv'],
    },
    maxFiles: 1,
    disabled: status === 'parsing',
  })

  const loadSample = useCallback(async () => {
    const XLSX = await import('xlsx')
    const ws = XLSX.utils.aoa_to_sheet(SAMPLE_DATA)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    processFile(buf, 'sample_rfp.xlsx')
  }, [processFile])

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h2 className="text-xl font-semibold tracking-tight mb-1">Upload your RFP / RFI</h2>
        <p className="text-sm text-muted-foreground">
          Upload a spreadsheet and we'll extract all requirements automatically. You'll map the columns in the next step.
        </p>
      </div>

      {/* Drop zone */}
      <div
        {...getRootProps()}
        className={cn(
          'relative border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-all duration-200',
          'hover:border-primary/50 hover:bg-primary/[0.02]',
          isDragActive && 'border-primary bg-primary/5 scale-[1.01]',
          status === 'parsing' && 'pointer-events-none opacity-70',
          status === 'done' && 'border-emerald-500/50 bg-emerald-500/[0.02]',
          status === 'error' && 'border-destructive/50 bg-destructive/[0.02]',
          !isDragActive && status === 'idle' && 'border-border'
        )}
      >
        <input {...getInputProps()} />

        <AnimatePresence mode="wait">
          {status === 'idle' && (
            <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
                <Upload className="w-6 h-6 text-muted-foreground" />
              </div>
              <p className="text-base font-medium text-foreground mb-1">
                {isDragActive ? 'Drop your file here' : 'Drop your spreadsheet here'}
              </p>
              <p className="text-sm text-muted-foreground mb-4">
                or click to browse your files
              </p>
              <div className="flex items-center justify-center gap-2 flex-wrap">
                {['.xlsx', '.xls', '.csv'].map((ext) => (
                  <span key={ext} className="px-2.5 py-1 bg-muted rounded-full text-xs font-mono text-muted-foreground">
                    {ext}
                  </span>
                ))}
              </div>
            </motion.div>
          )}

          {status === 'parsing' && (
            <motion.div key="parsing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                <FileSpreadsheet className="w-6 h-6 text-primary animate-pulse" />
              </div>
              <p className="text-base font-medium">Parsing {filename}...</p>
              <p className="text-sm text-muted-foreground mt-1">Extracting sheets and detecting columns</p>
              <div className="mt-4 h-1 w-48 mx-auto bg-muted rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-primary rounded-full"
                  initial={{ width: '0%' }}
                  animate={{ width: '90%' }}
                  transition={{ duration: 0.8, ease: 'easeOut' }}
                />
              </div>
            </motion.div>
          )}

          {status === 'done' && (
            <motion.div key="done" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-6 h-6 text-emerald-500" />
              </div>
              <p className="text-base font-medium text-emerald-600 dark:text-emerald-400">File parsed successfully!</p>
              <p className="text-sm text-muted-foreground mt-1">Redirecting to column mapping...</p>
            </motion.div>
          )}

          {status === 'error' && (
            <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="w-14 h-14 rounded-2xl bg-destructive/10 flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="w-6 h-6 text-destructive" />
              </div>
              <p className="text-base font-medium text-destructive">Failed to parse file</p>
              <p className="text-sm text-muted-foreground mt-1">{error}</p>
              <p className="text-xs text-muted-foreground mt-2">Click to try a different file</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Sample data button */}
      <div className="mt-6 flex items-center gap-3">
        <div className="flex-1 h-px bg-border" />
        <span className="text-xs text-muted-foreground">or</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      <div className="mt-4 text-center">
        <button
          onClick={loadSample}
          disabled={status === 'parsing'}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border hover:border-primary/40 hover:bg-primary/5 text-sm text-muted-foreground hover:text-foreground transition-all duration-150 disabled:opacity-50"
        >
          <Zap className="w-3.5 h-3.5 text-primary" />
          Try with sample RFP data
        </button>
        <p className="text-xs text-muted-foreground mt-2">
          12 requirements across Data Classification, DLP, Security, Compliance, Integration
        </p>
      </div>
    </div>
  )
}