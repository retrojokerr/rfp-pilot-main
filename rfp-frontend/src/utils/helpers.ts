import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { ResponseStatus } from '@/types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  }).format(new Date(iso))
}

export function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return formatDate(iso)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatConfidence(score: number): string {
  return `${Math.round(score * 100)}%`
}

export function confidenceColor(label: 'high' | 'medium' | 'low'): string {
  return {
    high: 'text-success',
    medium: 'text-warning',
    low: 'text-danger',
  }[label]
}

export function confidenceBg(label: 'high' | 'medium' | 'low'): string {
  return {
    high: 'badge-success',
    medium: 'badge-warning',
    low: 'badge-danger',
  }[label]
}

export function availabilityConfig(avail: string) {
  // Semantic mapping (app-wide rule): Yes = success · No = danger ·
  // Partial = warning · Unknown = neutral. Colors come ONLY from the
  // CSS-variable tokens in globals.css — never raw palette classes.
  switch (avail?.toLowerCase()) {
    case 'yes': return {
      color: 'text-success',
      bg: 'bg-success-bg',
      border: 'border-success-border',
      dot: 'bg-success',
    }
    case 'no': return {
      color: 'text-danger',
      bg: 'bg-danger-bg',
      border: 'border-danger-border',
      dot: 'bg-danger',
    }
    case 'partial': return {
      color: 'text-warning',
      bg: 'bg-warning-bg',
      border: 'border-warning-border',
      dot: 'bg-warning',
    }
    default: return {
      color: 'text-muted-foreground',
      bg: 'bg-muted',
      border: 'border-border',
      dot: 'bg-muted-foreground/50',
    }
  }
}

export function itemTypeLabel(type: string): string {
  return {
    question: 'Question',
    requirement: 'Requirement',
    compliance: 'Compliance',
    use_case: 'Use Case',
    action_item: 'Action Item',
  }[type] ?? type
}

export function priorityConfig(priority: string) {
  return {
    high: { color: 'text-danger', bg: 'bg-danger-bg', label: 'High' },
    medium: { color: 'text-warning', bg: 'bg-warning-bg', label: 'Medium' },
    low: { color: 'text-muted-foreground', bg: 'bg-muted', label: 'Low' },
  }[priority] ?? { color: 'text-muted-foreground', bg: 'bg-muted', label: priority }
}

export function exportToCSV(rows: Record<string, string>[], filename: string) {
  const headers = Object.keys(rows[0] ?? {})
  const csv = [
    headers.join(','),
    ...rows.map((row) =>
      headers.map((h) => `"${String(row[h] ?? '').replace(/"/g, '""')}"`).join(',')
    ),
  ].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export const SECURITY_KEYWORDS = [
  'security', 'dlp', 'encrypt', 'auth', 'sso', 'mfa', 'compliance',
  'gdpr', 'sebi', 'pci', 'rbi', 'classification', 'firewall', 'siem',
  'vulnerability', 'dpdp', 'hipaa', 'irdai', 'mandatory', 'critical',
]

// ── Response status taxonomy ──────────────────────────────────
// Single source of truth for "this row already has a usable answer".
// Previously each component kept its own slightly different inline list,
// which caused counts, exports and the regenerate-skip logic to disagree.
export const ANSWERED_STATUSES: ResponseStatus[] = [
  'generated', 'needs_review', 'approved', 'rejected', 'exported',
]

export function isAnswered(status: ResponseStatus): boolean {
  return ANSWERED_STATUSES.includes(status)
}

// ── Persisted app settings ────────────────────────────────────
// Used by the Settings page AND read live by services/api.ts and the
// generation engine, so "Save settings" actually changes behaviour.
export interface AppSettings {
  apiUrl: string
  requestDelayMs: number
  maxBatch: number
}

const SETTINGS_KEY = 'rfi-pilot-settings'

const DEFAULT_SETTINGS: AppSettings = {
  apiUrl: '',          // empty → fall back to NEXT_PUBLIC_API_URL / localhost:8000
  requestDelayMs: 350,
  maxBatch: 20,
}

export function getAppSettings(): AppSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveAppSettings(settings: Partial<AppSettings>): AppSettings {
  const merged = { ...getAppSettings(), ...settings }
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged))
  }
  return merged
}
