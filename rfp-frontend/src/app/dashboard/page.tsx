'use client'

import { useState, useEffect } from 'react'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { ArrowRight, FileText, CheckCircle2, Clock, XCircle, AlertTriangle, Database, BarChart3, Upload, ChevronRight } from 'lucide-react'
import { cn, formatRelativeTime, formatConfidence, isAnswered } from '@/utils/helpers'
import { useReviewStore } from '@/stores/reviewStore'
import { fetchKnowledgeStats, fetchSharedFeedback } from '@/services/api'
import { GitBranch, FileStack } from 'lucide-react'
import { useWizardStore } from '@/stores/wizardStore'

const CONTAINER = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.05 } } }
const ITEM = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.25 } } }

export default function DashboardPage() {
  // Use stable primitive selectors — never call functions inside selectors
  const responses = useReviewStore((s) => s.responses)

  // SHARED org-wide stats — same numbers for every user (backend-sourced).
  // The response stats below them are per-browser until review state moves
  // server-side.
  const [shared, setShared] = useState<{ vectors: number; documents: number; corrections: number } | null>(null)
  useEffect(() => {
    let alive = true
    Promise.all([
      fetchKnowledgeStats().catch(() => null),
      fetchSharedFeedback().catch(() => [] as Awaited<ReturnType<typeof fetchSharedFeedback>>),
    ]).then(([kb, fb]) => {
      if (!alive) return
      setShared({
        vectors: kb?.vectorCount ?? 0,
        documents: kb?.documentCount ?? 0,
        corrections: fb.length,
      })
    })
    return () => { alive = false }
  }, [])
  const wizardItems = useWizardStore((s) => s.items)

  // Compute derived stats in the component body (stable, memoized-like)
  const total = responses.length
  const generated = responses.filter((r) => isAnswered(r.status)).length
  const needsReview = responses.filter((r) => r.status === 'needs_review').length
  const approved = responses.filter((r) => r.status === 'approved').length
  const rejected = responses.filter((r) => r.status === 'rejected').length
  const exported = responses.filter((r) => r.status === 'exported').length
  const lowConfidence = responses.filter((r) => (r.confidence?.score ?? 0) < 0.7).length
  const scores = responses.map((r) => r.confidence?.score ?? 0).filter(Boolean)
  const avgConfidence = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
  const stats = { total, generated, needsReview, approved, rejected, exported, lowConfidence, avgConfidence }

  const recentResponses = responses.slice(-5).reverse()
  const exportRate = total > 0 ? Math.round((exported / total) * 100) : 0

  const kpis = [
    { label: 'Total Generated', value: stats.generated, icon: FileText, color: 'text-primary', link: '/workspace' },
    { label: 'Needs Review', value: stats.needsReview, icon: Clock, color: 'text-amber-500', link: '/review-queue' },
    { label: 'Approved', value: stats.approved, icon: CheckCircle2, color: 'text-emerald-500', link: '/review-queue' },
    { label: 'Low Confidence', value: stats.lowConfidence, icon: AlertTriangle, color: 'text-orange-500', link: '/review-queue?filter=low_confidence' },
    { label: 'Rejected', value: stats.rejected, icon: XCircle, color: 'text-red-500', link: '/review-queue' },
    { label: 'Avg Confidence', value: stats.avgConfidence > 0 ? formatConfidence(stats.avgConfidence) : '—', icon: BarChart3, color: 'text-violet-500', link: '/workspace' },
  ]

  const isEmpty = stats.total === 0

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
        className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Operations Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isEmpty ? 'No responses yet — start by uploading an RFP in Workspace.' : `${stats.total} responses across ${wizardItems.length} questions`}
          </p>
        </div>
        <Link href="/workspace"
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
          <Upload className="w-4 h-4" /> New RFP
        </Link>
      </motion.div>

      {/* Shared knowledge — organisation-wide, same for every user */}
      {shared && (
        <div className="panel grid grid-cols-3 divide-x divide-border">
          {[
            { label: 'Knowledge vectors', value: shared.vectors, icon: Database, hint: 'documents + learned answers' },
            { label: 'Source documents', value: shared.documents, icon: FileStack, hint: 'in the shared knowledge base' },
            { label: 'Human corrections', value: shared.corrections, icon: GitBranch, hint: 'taught by the whole team' },
          ].map(({ label, value, icon: Icon, hint }) => (
            <div key={label} className="px-4 py-3 flex items-center gap-3">
              <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              <div>
                <div className="text-lg font-semibold font-mono tnum">{value.toLocaleString()}</div>
                <div className="text-2xs text-muted-foreground">{label} · <span className="opacity-70">{hint}</span></div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* KPIs — your activity in this browser (review state is local until
          it moves server-side) */}
      <motion.div variants={CONTAINER} initial="hidden" animate="show"
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {kpis.map((kpi) => (
          <motion.div key={kpi.label} variants={ITEM}>
            <Link href={kpi.link}
              className="block bg-card border border-border rounded-xl p-4 hover:border-primary/30 transition-colors">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-medium text-muted-foreground">{kpi.label}</span>
                <kpi.icon className={cn('w-4 h-4', kpi.color)} />
              </div>
              <div className="text-2xl font-bold font-mono tracking-tight">{kpi.value}</div>
            </Link>
          </motion.div>
        ))}
      </motion.div>

      <div className="grid lg:grid-cols-3 gap-6">

        {/* Recent responses */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
          className="lg:col-span-2 bg-card border border-border rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold">Recent responses</h2>
            <Link href="/review-queue" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
              Review queue <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          {recentResponses.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-muted-foreground">
              No responses yet. Generate answers in the Workspace.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {recentResponses.map((r, i) => {
                const confLabel = r.confidence?.label ?? 'low'
                return (
                  <motion.div key={r.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 + i * 0.04 }}
                    className="px-5 py-3 hover:bg-muted/30 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        {r.section && <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">{r.section}</p>}
                        <p className="text-sm font-medium text-foreground truncate">{r.question}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{r.availability} · {formatRelativeTime(r.generatedAt ?? new Date().toISOString())}</p>
                      </div>
                      <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0',
                        confLabel === 'high' ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400' :
                        confLabel === 'medium' ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400' :
                        'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400')}>
                        {formatConfidence(r.confidence?.score ?? 0)}
                      </span>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          )}
        </motion.div>

        {/* Side panel */}
        <div className="space-y-4">

          {/* Confidence distribution */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
            className="bg-card border border-border rounded-xl p-4">
            <h2 className="text-sm font-semibold mb-3">Confidence distribution</h2>
            {stats.total === 0 ? (
              <p className="text-xs text-muted-foreground">No data yet</p>
            ) : (
              <div className="space-y-2">
                {[
                  { label: 'High (≥80%)', count: responses.filter(r => (r.confidence?.score ?? 0) >= 0.8).length, color: 'bg-emerald-500' },
                  { label: 'Medium (60–80%)', count: responses.filter(r => { const s = r.confidence?.score ?? 0; return s >= 0.6 && s < 0.8 }).length, color: 'bg-amber-500' },
                  { label: 'Low (<60%)', count: responses.filter(r => (r.confidence?.score ?? 0) < 0.6).length, color: 'bg-red-500' },
                ].map(({ label, count, color }) => (
                  <div key={label} className="flex items-center gap-2">
                    <div className="flex-1">
                      <div className="flex items-center justify-between text-xs mb-1">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-mono font-medium">{count}</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className={cn('h-full rounded-full', color)}
                          style={{ width: stats.total > 0 ? `${(count / stats.total) * 100}%` : '0%' }} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>

          {/* Quick links */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
            className="bg-card border border-border rounded-xl p-4">
            <h2 className="text-sm font-semibold mb-3">Quick actions</h2>
            <div className="space-y-1">
              {[
                { href: '/workspace', label: 'Upload & generate', icon: Upload },
                { href: '/assistant', label: 'Ask the AI assistant', icon: Database },
                { href: '/review-queue', label: `Review queue (${stats.needsReview})`, icon: Clock },
                { href: '/knowledge', label: 'Manage knowledge base', icon: Database },
              ].map(({ href, label, icon: Icon }) => (
                <Link key={href} href={href}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-muted transition-colors text-sm text-muted-foreground hover:text-foreground">
                  <Icon className="w-3.5 h-3.5" />
                  <span className="flex-1">{label}</span>
                  <ChevronRight className="w-3 h-3" />
                </Link>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  )
}