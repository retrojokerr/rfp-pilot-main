'use client'

import { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import {
  ThumbsUp, ThumbsDown, CheckCircle2, XCircle,
  Download, Trash2, AlertTriangle, BookOpen,
  BarChart3, Sparkles, Search, RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn, formatRelativeTime } from '@/utils/helpers'
import { useFeedbackStore } from '@/stores/feedbackStore'
import type { FeedbackPair, KnowledgeGap } from '@/types'
import { fetchSharedFeedback } from '@/services/api'


// Strip "AVAILABILITY: Yes\nREMARKS: " prefix from raw Slack bot answers
function cleanSlackAnswer(text: string): string {
  if (!text) return ''
  // Handle format: "AVAILABILITY: Yes\nREMARKS: ..."
  const remarksMatch = text.match(/REMARKS:\s*(.+)/si)
  if (remarksMatch) return remarksMatch[1].trim()
  // Handle just AVAILABILITY line
  return text
    .replace(/^AVAILABILITY:\s*\w+\s*\n?/i, '')
    .replace(/^REMARKS:\s*/i, '')
    .trim()
}

const SIGNAL_CONFIG = {
  thumbs_up:  { icon: ThumbsUp,      color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-950/40', label: 'Helpful' },
  thumbs_down:{ icon: ThumbsDown,    color: 'text-red-500',     bg: 'bg-red-50 dark:bg-red-950/40',         label: 'Flagged' },
  approved:   { icon: CheckCircle2,  color: 'text-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-950/40', label: 'Approved' },
  rejected:   { icon: XCircle,       color: 'text-red-500',     bg: 'bg-red-50 dark:bg-red-950/40',         label: 'Flagged' },
  edited:     { icon: Sparkles,      color: 'text-amber-500',   bg: 'bg-amber-50 dark:bg-amber-950/40',     label: 'Corrected' },
}

export default function FeedbackPage() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const pairs = useFeedbackStore((s) => s.pairs)
  const gaps = useFeedbackStore((s) => s.gaps)
  const { resolveGap } = useFeedbackStore()

  const [tab, setTab] = useState<'pairs' | 'gaps'>('pairs')
  const [search, setSearch] = useState('')
  const [signalFilter, setSignalFilter] = useState<string>('all')
  const [slackPairs, setSlackPairs] = useState<FeedbackPair[]>([])
  const [slackLoading, setSlackLoading] = useState(false)

  // Fetch the SHARED org-wide feedback ledger (all users, all channels).
  // Uses the authed API client — the old raw fetch had no Authorization
  // header and silently 401'd after RBAC landed.
  const fetchSlackFeedback = async () => {
    setSlackLoading(true)
    try {
      const sharedPairs = await fetchSharedFeedback()
      const VALID_SOURCES = ['slack', 'workspace', 'assistant', 'review_queue'] as const
      const converted: FeedbackPair[] = sharedPairs.map((p) => ({
        id: (p.logged_at ?? '') + (p.email ?? '') || Math.random().toString(36).slice(2),
        question: p.question ?? '',
        section: p.section ?? '',
        badAnswer: p.bad_answer ?? '',
        goodAnswer: p.good_answer ?? '',
        availability: 'Unknown' as const,
        confidence: p.confidence ?? 0,
        signal: p.signal === 'thumbs_up' ? 'thumbs_up' :
                p.signal === 'thumbs_down' ? 'thumbs_down' :
                p.signal === 'correction' ? 'edited' : 'thumbs_down',
        source: (VALID_SOURCES as readonly string[]).includes(p.source ?? '')
          ? (p.source as (typeof VALID_SOURCES)[number])
          : ('slack' as const),
        actor: p.user ?? p.email ?? 'Teammate',
        createdAt: p.logged_at ?? new Date().toISOString(),
        approved: p.signal === 'thumbs_up' || !!p.good_answer,
        usedForTraining: false,
        notes: p.signal,
      }))
      setSlackPairs(converted)
    } catch (err) {
      console.warn('Shared feedback fetch failed:', err)
    } finally {
      setSlackLoading(false)
    }
  }

  useEffect(() => {
    if (!mounted) return
    fetchSlackFeedback()
    // Auto-refresh every 30 seconds so new Slack feedback shows up
    const interval = setInterval(fetchSlackFeedback, 30000)
    return () => clearInterval(interval)
  }, [mounted])

  // Merge web + slack pairs
  // Merge local (instant, this browser) + shared (all users) and dedupe:
  // a correction made here appears in BOTH once the server log syncs.
  const allPairs = useMemo(() => {
    const seen = new Set(pairs.map((p) => `${p.question}\u0000${p.goodAnswer}`))
    const remoteOnly = slackPairs.filter((p) => !seen.has(`${p.question}\u0000${p.goodAnswer}`))
    // Sort merged list by createdAt descending. Both API and Slack sources
    // stamp ISO timestamps, so lexical descending == chronological newest
    // first. Missing timestamps sort to the bottom — better than random.
    return [...pairs, ...remoteOnly].sort((a, b) => {
      const aTs = a.createdAt ?? ''
      const bTs = b.createdAt ?? ''
      return bTs.localeCompare(aTs)
    })
  }, [pairs, slackPairs])

  const stats = useMemo(() => {
    const bySource = { workspace: 0, assistant: 0, review_queue: 0, slack: 0 } as Record<string, number>
    const bySignal = { thumbs_up: 0, thumbs_down: 0, approved: 0, rejected: 0, edited: 0 } as Record<string, number>
    allPairs.forEach((p) => {
      bySource[p.source] = (bySource[p.source] ?? 0) + 1
      bySignal[p.signal] = (bySignal[p.signal] ?? 0) + 1
    })
    return {
      total: allPairs.length,
      approved: allPairs.filter((p) => p.approved).length,
      pending: allPairs.filter((p) => !p.approved).length,
      usedForTraining: allPairs.filter((p) => p.usedForTraining).length,
      bySource, bySignal,
    }
  }, [allPairs])

  const filteredPairs = useMemo(() => {
    let ps = allPairs
    if (signalFilter !== 'all') ps = ps.filter((p) => {
      if (signalFilter === 'thumbs_down') return p.signal === 'thumbs_down' || p.signal === 'rejected'
      return p.signal === signalFilter
    })
    if (search) {
      const q = search.toLowerCase()
      ps = ps.filter((p) => p.question.toLowerCase().includes(q))
    }
    return ps
  }, [allPairs, signalFilter, search])

  const filteredGaps = useMemo(() => {
    if (!search) return gaps.filter((g) => !g.resolved)
    return gaps.filter((g) => !g.resolved && g.question.toLowerCase().includes(search.toLowerCase()))
  }, [gaps, search])

  if (!mounted) return (
    <div className="p-6 flex items-center gap-2 text-muted-foreground text-sm">
      <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      Loading...
    </div>
  )

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Feedback Loop</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Capture corrections and signals to improve AI answer quality over time.
          </p>
        </div>
        <div className="flex gap-2">
          {/* Corrections are ingested into the knowledge base automatically
              at the source (workspace / assistant / review queue / Slack) —
              this page is an org-wide observability view, so the only
              action it needs is a refresh of the shared ledger. */}
          <button onClick={fetchSlackFeedback} disabled={slackLoading}
            aria-label="Refresh shared feedback"
            className="btn-outline">
            <RefreshCw className={cn('w-3.5 h-3.5', slackLoading && 'animate-spin')} /> Refresh
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total signals', value: stats.total, icon: BarChart3, color: 'text-primary' },
          { label: 'Corrections learned', value: allPairs.filter((p) => !!p.goodAnswer).length, icon: CheckCircle2, color: 'text-success' },
          { label: 'Thumbs down', value: stats.bySignal['thumbs_down'] ?? 0, icon: AlertTriangle, color: 'text-warning' },
          { label: 'Knowledge gaps', value: filteredGaps.length, icon: BookOpen, color: 'text-violet-500' },
        ].map(({ label, value, icon: Icon, color }) => (
          <motion.div key={label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="bg-card border border-border rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">{label}</span>
              <Icon className={cn('w-4 h-4', color)} />
            </div>
            <div className="text-2xl font-bold font-mono">{value}</div>
          </motion.div>
        ))}
      </div>

      {/* Source breakdown */}
      {stats.total > 0 && (
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Signals by source</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Workspace', key: 'workspace', color: 'bg-primary' },
              { label: 'Assistant', key: 'assistant', color: 'bg-violet-500' },
              { label: 'Review Queue', key: 'review_queue', color: 'bg-amber-500' },
              { label: 'Slack', key: 'slack', color: 'bg-emerald-500' },
            ].map(({ label, key, color }) => (
              <div key={key}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="font-mono font-medium">{stats.bySource[key] ?? 0}</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div className={cn('h-full rounded-full', color)}
                    style={{ width: stats.total > 0 ? `${((stats.bySource[key] ?? 0) / stats.total) * 100}%` : '0%' }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {[
          { id: 'pairs', label: `Feedback pairs (${stats.total})` },
          { id: 'gaps', label: `Knowledge gaps (${filteredGaps.length})` },
        ].map(({ id, label }) => (
          <button key={id} onClick={() => setTab(id as 'pairs' | 'gaps')}
            className={cn('px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
              tab === id
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search questions..."
            className="w-full pl-9 pr-4 py-2 text-sm bg-muted/40 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 transition-all" />
        </div>
        {tab === 'pairs' && (
          <div className="flex gap-1.5 flex-wrap">
            {[
              { key: 'all',         label: 'All' },
              { key: 'edited',      label: 'Corrected' },
              { key: 'thumbs_down', label: 'Flagged' },
              { key: 'approved',    label: 'Approved' },
              { key: 'thumbs_up',   label: 'Helpful' },
            ].map(({ key, label }) => (
              <button key={key} onClick={() => setSignalFilter(key)}
                className={cn('px-3 py-1.5 rounded-lg text-xs font-medium border transition-all',
                  signalFilter === key ? 'bg-primary/10 text-primary border-primary/30' : 'text-muted-foreground border-transparent hover:border-border')}>
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Pairs list */}
      {tab === 'pairs' && (
        <div className="space-y-2">
          {filteredPairs.length === 0 ? (
            <div className="bg-card border border-border rounded-xl p-10 text-center">
              <BarChart3 className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                {stats.total === 0
                  ? 'No feedback yet. Corrections made anywhere — workspace, assistant, review queue, or Slack — appear here automatically.'
                  : 'No pairs match this filter.'}
              </p>
            </div>
          ) : filteredPairs.map((pair) => (
            <FeedbackPairCard key={pair.id} pair={pair} />
          ))}
        </div>
      )}

      {/* Gaps list */}
      {tab === 'gaps' && (
        <div className="space-y-2">
          {filteredGaps.length === 0 ? (
            <div className="bg-card border border-border rounded-xl p-10 text-center">
              <BookOpen className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                No knowledge gaps detected. Gaps appear when low-confidence answers are rejected.
              </p>
            </div>
          ) : filteredGaps.map((gap) => (
            <GapCard key={gap.id} gap={gap} onResolve={() => { resolveGap(gap.id); toast.success('Gap marked as resolved') }} />
          ))}
        </div>
      )}
    </div>
  )
}

function FeedbackPairCard({ pair }: {
  pair: FeedbackPair
}) {
  const [expanded, setExpanded] = useState(false)
  const cfg = SIGNAL_CONFIG[pair.signal]
  const Icon = cfg.icon
  const hasDiff = pair.badAnswer || pair.goodAnswer

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-start gap-3 p-4 cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <span className={cn('inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded flex-shrink-0 mt-0.5', cfg.color, cfg.bg)}>
          <Icon className="w-3 h-3" />{cfg.label}
        </span>
        <div className="flex-1 min-w-0">
          {pair.section && <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">{pair.section}</p>}
          <p className="text-sm font-medium text-foreground line-clamp-1">{pair.question}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] text-muted-foreground capitalize">{pair.source.replace('_', ' ')}</span>
            <span className="text-[10px] text-muted-foreground">·</span>
            <span className="text-[10px] text-muted-foreground">{Math.round(pair.confidence * 100)}% confidence</span>
            <span className="text-[10px] text-muted-foreground">·</span>
            <span className="text-[10px] text-muted-foreground">{formatRelativeTime(pair.createdAt)}</span>
            {!!pair.goodAnswer && <span className="text-[10px] text-success font-medium">✓ In knowledge base</span>}
          </div>
        </div>

      </div>

      {expanded && hasDiff && (
        <div className="px-4 pb-4 border-t border-border/50 pt-3 space-y-3">
          {pair.badAnswer && (
            <div>
              <p className="text-[10px] font-semibold text-red-600 dark:text-red-400 uppercase tracking-wide mb-1.5">Original AI answer</p>
              <p className="text-xs text-muted-foreground bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg p-3 leading-relaxed whitespace-pre-wrap">
                {pair.badAnswer}
              </p>
            </div>
          )}
          {pair.goodAnswer ? (
            <div>
              <p className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide mb-1.5">Corrected answer</p>
              <p className="text-xs text-foreground bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 rounded-lg p-3 leading-relaxed whitespace-pre-wrap">
                {pair.goodAnswer}
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground italic">No correction submitted yet — user only flagged this answer.</p>
          )}
        </div>
      )}
    </motion.div>
  )
}

function GapCard({ gap, onResolve }: { gap: KnowledgeGap; onResolve: () => void }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 flex items-start gap-3">
      <div className="w-9 h-9 rounded-lg bg-violet-50 dark:bg-violet-950/40 flex items-center justify-center flex-shrink-0">
        <BookOpen className="w-4 h-4 text-violet-500" />
      </div>
      <div className="flex-1 min-w-0">
        {gap.section && <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-0.5">{gap.section}</p>}
        <p className="text-sm font-medium text-foreground line-clamp-2">{gap.question}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className="text-[10px] text-muted-foreground">{gap.occurrences}× failed</span>
          <span className="text-[10px] text-muted-foreground">·</span>
          <span className="text-[10px] text-muted-foreground">{Math.round(gap.avgConfidence * 100)}% avg confidence</span>
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3 text-amber-500" />
          <span className="text-[11px] text-amber-700 dark:text-amber-400">Suggested: add <span className="font-medium">{gap.suggestedDocTopic}</span> to knowledge base</span>
        </div>
      </div>
      <button onClick={onResolve}
        className="flex-shrink-0 px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors">
        Resolve
      </button>
    </div>
  )
}