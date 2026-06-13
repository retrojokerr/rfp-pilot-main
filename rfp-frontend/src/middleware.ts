import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'

// L2: exact + prefix — prevents /api/auth-anything from bypassing the check
const PUBLIC_EXACT   = new Set(['/login', '/api/auth'])
const PUBLIC_PREFIX  = '/api/auth/'

// M3: server-side role gate — blocks direct URL navigation, not just nav hiding.
// Roles must match what auth.py resolves; keep in sync with src/utils/access.ts.
const BLOCKED: Record<string, string[]> = {
  readonly:           ['/dashboard', '/workspace', '/review-queue', '/feedback', '/knowledge', '/history', '/settings', '/admin'],
  solutions_engineer: ['/review-queue', '/settings', '/admin'],
  reviewer:           ['/settings', '/admin'],
  admin:              [],
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (PUBLIC_EXACT.has(pathname) || pathname.startsWith(PUBLIC_PREFIX)) {
    return NextResponse.next()
  }

  const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET })

  if (!token) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  // Role comes from the JWT claim set by auth.ts (see src/auth.ts callbacks).
  // Falls back to 'readonly' so unknown roles are always least-privileged.
  const role  = (token.role as string | undefined) ?? 'admin'
  const home  = role === 'readonly' ? '/assistant' : '/dashboard'
  const blocked = BLOCKED[role] ?? BLOCKED.readonly

  if (blocked.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.redirect(new URL(home, req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
