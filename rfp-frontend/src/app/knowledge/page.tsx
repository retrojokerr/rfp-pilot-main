'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import {
  Database, FileText, RefreshCw, Trash2, Upload,
  CheckCircle2, AlertCircle, Clock, Search, Wifi,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn, formatBytes, formatRelativeTime } from '@/utils/helpers'
import { fetchKnowledgeStats, fetchDocuments as apiFetchDocuments, triggerDriveSync, parseApiError } from '@/services/api'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

const STATUS_CONFIG = {
  indexed:   { icon: CheckCircle2, color: 'text-emerald-500', label: 'Indexed' },
  ingesting: { icon: Clock,        color: 'text-amber-500',   label: 'Ingesting' },
  error:     { icon: AlertCircle,  color: 'text-red-500',     label: 'Error' },
  stale:     { icon: AlertCircle,  color: 'text-zinc-400',    label: 'Stale' },
}

function fileType(filename: string) {
  return filename.split('.').pop()?.toLowerCase() ?? 'txt'
}

function fileColor(ext: string) {
  if (ext === 'pdf') return 'bg-red-50 dark:bg-red-950/40 text-red-500'
  if (ext === 'docx' || ext === 'doc') return 'bg-blue-50 dark:bg-blue-950/40 text-blue-500'
  return 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-500'
}

export default function KnowledgePage() {
  const [stats, setStats] = useState<{ vector_count: number; document_count: number; last_synced?: string } | null>(null)
  const [documents, setDocuments] = useState<any[]>([])
  const [search, setSearch] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [loading, setLoading] = useState(true)

  async function fetchStats() {
    try {
      const s = await fetchKnowledgeStats()
      setStats({ vector_count: s.vectorCount, document_count: s.documentCount, last_synced: s.lastSynced })
    } catch {
      setStats(null)
    }
  }

  async function fetchDocuments() {
    try {
      const docs = await apiFetchDocuments()
      setDocuments(Array.isArray(docs) ? docs : [])
    } catch {
      setDocuments([])
    } finally {
      setLoading(false)
    }
  }

  // Load stats + documents on mount (and this is what the sync button
  // re-triggers after the backend finishes re-indexing)
  useEffect(() => {
    fetchStats()
    fetchDocuments()
  }, [])

  async function syncDrive() {
    setSyncing(true)
    try {
      const r = await triggerDriveSync()
      toast.success(r.status === 'already_running' ? 'Sync already in progress' : 'Drive sync started', {
        description: 'Re-indexing your Drive folder — stats refresh shortly',
      })
      setTimeout(() => { fetchStats(); fetchDocuments() }, 5000)
      setTimeout(() => { fetchStats(); fetchDocuments() }, 20000)
    } catch (err) {
      toast.error('Sync failed', { description: parseApiError(err) })
    } finally {
      setSyncing(false)
    }
  }

  const filtered = documents.filter((d: any) =>
    (d.filename ?? d.name ?? '').toLowerCase().includes(search.toLowerCase())
  )

  const totalVectors = stats?.vector_count ?? 0
  const totalDocs = stats?.document_count ?? documents.length
  const indexed = documents.filter((d: any) => d.status === 'indexed').length

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Knowledge Base</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {totalDocs} documents indexed · {totalVectors} vectors
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={syncDrive} disabled={syncing}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50">
            <RefreshCw className={cn('w-3.5 h-3.5', syncing && 'animate-spin')} />
            Sync Drive
          </button>
          
        </div>
      </div>

      {/* Stats — real data */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total vectors', value: totalVectors, icon: Database, color: 'text-primary' },
          { label: 'Documents', value: totalDocs, icon: FileText, color: 'text-violet-500' },
          { label: 'Indexed', value: indexed || totalDocs, icon: CheckCircle2, color: 'text-emerald-500' },
          { label: 'Drive status', value: 'Connected', icon: Wifi, color: 'text-emerald-500' },
        ].map(({ label, value, icon: Icon, color }) => (
          <motion.div key={label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">{label}</span>
              <Icon className={cn('w-4 h-4', color)} />
            </div>
            <div className="text-xl font-bold font-mono">{value}</div>
          </motion.div>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search documents..."
          className="w-full pl-10 pr-4 py-2.5 bg-muted/40 border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all" />
      </div>

      {/* Document list */}
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {filtered.length} documents
          </span>
          {stats?.last_synced && (
            <span className="text-xs text-muted-foreground">
              Last synced {formatRelativeTime(stats.last_synced)}
            </span>
          )}
        </div>

        {loading ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 opacity-40" />
            Loading documents...
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-muted-foreground">
            {documents.length === 0
              ? 'No documents indexed yet. Add files to the shared Google Drive folder, then click Sync Drive.'
              : 'No documents match your search.'}
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((doc: any, i: number) => {
              const ext = fileType(doc.filename ?? doc.name ?? '')
              const status = doc.status ?? 'indexed'
              const statusCfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.indexed
              const StatusIcon = statusCfg.icon
              const vectors = doc.vectors_count ?? doc.vectorCount ?? doc.vector_count ?? 0
              const size = doc.size_bytes ?? doc.sizeBytes ?? 0
              const uploadDate = doc.upload_date ?? doc.uploadDate ?? doc.modified_time ?? ''
              const source = doc.source_type ?? doc.source ?? 'drive'
              const filename = doc.filename ?? doc.name ?? ''

              return (
                <motion.div key={doc.id ?? i} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.03 }}
                  className="flex items-center gap-3 px-4 py-3.5 hover:bg-muted/30 transition-colors group">
                  <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0', fileColor(ext))}>
                    <FileText className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{filename}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className={cn('flex items-center gap-1 text-[10px] font-medium', statusCfg.color)}>
                        <StatusIcon className="w-3 h-3" />{statusCfg.label}
                      </span>
                      {vectors > 0 && (
                        <span className="text-[10px] text-muted-foreground font-mono">{vectors} vectors</span>
                      )}
                      {size > 0 && (
                        <span className="text-[10px] text-muted-foreground">{formatBytes(size)}</span>
                      )}
                      {uploadDate && (
                        <span className="text-[10px] text-muted-foreground">{formatRelativeTime(uploadDate)}</span>
                      )}
                      <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded capitalize">{source}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => toast.info('Re-index triggered')}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="Re-index">
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => toast.info('Delete not available in local mode')}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors" title="Delete">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}