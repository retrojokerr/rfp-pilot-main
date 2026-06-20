import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'

// Public routes that never require a session
const PUBLIC_EXACT  = new Set(['/login', '/api/auth', '/api/token'])
const PUBLIC_PREFIX = '/api/auth/'

const BLOCKED: Record<string, string[]> = {
  readonly:           ['/dashboard', '/workspace', '/review-queue', '/feedback', '/knowledge', '/history', '/settings', '/admin'],
  solutions_engineer: ['/review-queue', '/settings', '/admin'],
  reviewer:           ['/settings', '/admin'],
  admin:              [],
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // LOCAL DEV ONLY: bypass the auth gate when explicitly enabled in development.
  // Guarded by NODE_ENV so it can never weaken a production build.
  if (process.env.NODE_ENV === 'development' &&
      process.env.NEXT_PUBLIC_AUTH_DISABLED === 'true') {
    return NextResponse.next()
  }

  if (PUBLIC_EXACT.has(pathname) || pathname.startsWith(PUBLIC_PREFIX)) {
    return NextResponse.next()
  }

  // Detect HTTPS behind a proxy so getToken reads the __Secure- cookie.
  const isSecure =
    req.nextUrl.protocol === 'https:' ||
    req.headers.get('x-forwarded-proto') === 'https'

  const token = await getToken({
    req,
    secret: process.env.NEXTAUTH_SECRET,
    secureCookie: isSecure,
    cookieName: isSecure
      ? '__Secure-authjs.session-token'
      : 'authjs.session-token',
  })

  if (!token) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

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
