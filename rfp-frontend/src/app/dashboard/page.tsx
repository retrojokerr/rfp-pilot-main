'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useAutoRefresh } from '@/hooks/useAutoRefresh'

import { motion } from 'framer-motion'
import Link from 'next/link'
import { ArrowRight, FileText, CheckCircle2, Clock, XCircle, AlertTriangle, Database, BarChart3, Upload, ChevronRight } from 'lucide-react'
import { cn, formatRelativeTime, formatConfidence } from '@/utils/helpers'
import { fetchKnowledgeStats, fetchSharedFeedback, listSubmissions, fetchDashboardStats, type ReviewSubmission, type DashboardStats } from '@/services/api'
import { GitBranch, FileStack } from 'lucide-react'

const CONTAINER = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.05 } } }
const ITEM = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.25 } } }

export default function DashboardPage() {
  // SHARED org-wide stats — same numbers for every user (backend-sourced).
  const [shared, setShared] = useState<{ vectors: number; documents: number; corrections: number } | null>(null)

  // Submissions — the source of truth for team-wide dashboard counters.
  // Fetch once on mount; refetch happens implicitly when the user navigates
  // away and back (component re-mounts).
  const [subs, setSubs] = useState<ReviewSubmission[]>([])

  // Server-computed dashboard metrics (single source of truth).
  const [dstats, setDstats] = useState<DashboardStats | null>(null)
  // All dashboard data, refreshed on mount + tab focus + short interval.
  const refresh = useCallback(() => {
    Promise.all([
      fetchKnowledgeStats().catch(() => null),
      fetchSharedFeedback().catch(() => [] as Awaited<ReturnType<typeof fetchSharedFeedback>>),
    ]).then(([kb, fb]) => {
      setShared({
        vectors: kb?.vectorCount ?? 0,
        documents: kb?.documentCount ?? 0,
        corrections: fb.length,
      })
    }).catch(() => { /* leave prior stats on error */ })

    listSubmissions()
      .then(setSubs)
      .catch(() => { /* keep prior; UI shows "no submissions yet" if empty */ })

    fetchDashboardStats()
      .then(setDstats)
      .catch(() => { /* tiles fall back to placeholders */ })
  }, [])

  useAutoRefresh(refresh)

  // Format a duration in minutes into a human unit.
  const fmtDuration = (min: number): string => {
    if (min <= 0) return '—'
    if (min < 60) return `${min < 10 ? min.toFixed(1) : Math.round(min)} min`
    const hrs = min / 60
    if (hrs < 24) return `${hrs.toFixed(1)} h`
    return `${(hrs / 24).toFixed(1)} days`
  }

  // Flatten items across submissions once, tagging each with the parent
  // submission's status/display info. All counters below iterate this list.
  const items = useMemo(() =>
    subs.flatMap((s) => s.items.map((it) => ({
      key: `${s.id}:${it.question_id}`,
      section: it.section || s.display_name || s.sheet_name,
      question: it.question,
      availability: it.availability || '—',
      confidence: it.confidence ?? 0,
      submittedAt: s.submitted_at,
      subStatus: s.status,
      flagType: it.flag_type,     // accepted | corrected | flagged | untouched
      decision: it.decision,      // null | approved | rejected
    }))),
    [subs],
  )

  const stats = useMemo(() => {
    const total = items.length
    // Count by each item's OWN state, not its parent submission's status.
    // accepted = AI answer shipped as-is; corrected/flagged = needed human
    // attention; decision approved/rejected = the reviewer's per-item call.
    const accepted = items.filter((it) => it.flagType === 'accepted').length
    const corrections = items.filter((it) => it.flagType === 'corrected' || it.flagType === 'flagged').length
    const approved = items.filter((it) => it.decision === 'approved').length
    const rejected = items.filter((it) => it.decision === 'rejected').length
    // "Awaiting review" = touched items still sitting in a pending submission.
    const pending = items.filter((it) =>
      it.subStatus === 'pending' && (it.flagType === 'corrected' || it.flagType === 'flagged')).length
    const lowConfidence = items.filter((it) => it.confidence > 0 && it.confidence < 0.6).length
    const scores = items.map((it) => it.confidence).filter((c) => c > 0)
    const avgConfidence = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
    return { total, accepted, corrections, approved, rejected, pending, lowConfidence, avgConfidence }
  }, [items])

  const recentResponses = useMemo(() =>
    [...items]
      .sort((a, b) => (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''))
      .slice(0, 5),
    [items],
  )

  const kpis = [
    { label: 'RFPs processed', value: dstats?.rfps_processed ?? '—', icon: FileText, color: 'text-primary', link: '/my-submissions' },
    { label: 'In review', value: dstats?.in_review ?? '—', icon: Clock, color: 'text-amber-500', link: '/review-queue' },
    { label: 'Time saved', value: dstats ? `${dstats.days_saved} days` : '—', icon: CheckCircle2, color: 'text-emerald-500', link: '/my-submissions' },
    { label: 'Avg review time', value: dstats ? fmtDuration(dstats.median_review_minutes) : '—', icon: GitBranch, color: 'text-violet-500', link: '/review-queue' },
    { label: 'Avg confidence', value: dstats && dstats.avg_confidence > 0 ? formatConfidence(dstats.avg_confidence) : '—', icon: BarChart3, color: 'text-violet-500', link: '/workspace' },
  ]

  const isEmpty = stats.total === 0

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8">
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
        className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Operations Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isEmpty ? 'No responses yet — start by uploading an RFP in Workspace.' : `${stats.total} items across ${subs.length} submission${subs.length === 1 ? '' : 's'}`}
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
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
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

      {dstats && (
        <p className="text-2xs text-muted-foreground -mt-4">
          Time saved assumes ~{dstats.assumptions.manual_hours_per_rfp}h to fill an RFP manually,
          minus ~{dstats.assumptions.generation_hours_per_rfp}h generation. Review time is the median
          from first submission to final approval. Both exclude abandoned uploads.
        </p>
      )}

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
              {recentResponses.map((it, i) => {
                const confLabel = it.confidence >= 0.8 ? 'high' : it.confidence >= 0.6 ? 'medium' : 'low'
                return (
                  <motion.div key={it.key} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.25 + i * 0.04 }}
                    className="px-5 py-3 hover:bg-muted/30 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        {it.section && <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">{it.section}</p>}
                        <p className="text-sm font-medium text-foreground truncate">{it.question}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{it.availability} · {formatRelativeTime(it.submittedAt ?? new Date().toISOString())}</p>
                      </div>
                      <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0',
                        confLabel === 'high' ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400' :
                        confLabel === 'medium' ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400' :
                        'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-400')}>
                        {formatConfidence(it.confidence)}
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
                  { label: 'High (≥80%)', count: items.filter((it) => it.confidence >= 0.8).length, color: 'bg-emerald-500' },
                  { label: 'Medium (60–80%)', count: items.filter((it) => it.confidence >= 0.6 && it.confidence < 0.8).length, color: 'bg-amber-500' },
                  { label: 'Low (<60%)', count: items.filter((it) => it.confidence < 0.6).length, color: 'bg-red-500' },
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
                { href: '/review-queue', label: `Review queue (${stats.pending})`, icon: Clock },
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