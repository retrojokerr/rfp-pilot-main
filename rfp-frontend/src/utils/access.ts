import type { Role } from '@/services/api'

/**
 * Page access per role (mirrors the spec exactly):
 *   admin               → every page
 *   reviewer            → everything except Settings & Users
 *   solutions_engineer  → everything except Review Queue, Settings & Users
 *   readonly            → Assistant only
 *
 * This is UI routing convenience — every API call behind these pages is
 * independently enforced by the backend capability matrix.
 */
const BLOCKED_PREFIXES: Record<Role, string[]> = {
  admin: [],
  reviewer: ['/settings', '/admin'],
  solutions_engineer: ['/review-queue', '/settings', '/admin'],
  readonly: [
    '/dashboard', '/workspace', '/review-queue', '/feedback',
    '/knowledge', '/history', '/settings', '/admin',
  ],
}

export function canAccessRoute(role: Role | undefined | null, pathname: string): boolean {
  if (!role) return true // before /me loads — backend still enforces
  const blocked = BLOCKED_PREFIXES[role] ?? []
  return !blocked.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

/** Where to send someone who lands on a page their role can't see. */
export function homeRouteFor(role: Role | undefined | null): string {
  return role === 'readonly' ? '/assistant' : '/dashboard'
}
