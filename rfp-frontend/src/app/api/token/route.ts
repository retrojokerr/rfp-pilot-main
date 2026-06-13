/**
 * Mints a short-lived API token (15 min) from the NextAuth session.
 * Identity comes from the server-side session — the browser cannot forge it.
 * The backend verifies the signature and resolves the user's ROLE itself.
 *
 * Security note (H5): the token is returned to JS and held in memory only
 * (never localStorage). Combined with the 15-minute TTL and the strict CSP
 * (which blocks injected scripts and exfiltration to foreign origins), the
 * XSS exposure window is small. For defence-in-depth in a hardened
 * deployment, migrate to a same-origin proxy that injects an HttpOnly
 * cookie server-side (documented in SECURITY.md).
 */
import { NextResponse } from 'next/server'
import { SignJWT } from 'jose'
import { auth } from '@/auth'

const TTL_SECONDS = 15 * 60

export async function GET() {
  const session = await auth()
  const email = session?.user?.email
  if (!email) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 })
  }

  const secret = process.env.API_JWT_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'API_JWT_SECRET not configured' }, { status: 500 })
  }

  const token = await new SignJWT({ name: session.user?.name ?? email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(email)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(new TextEncoder().encode(secret))

  return NextResponse.json({ token, expiresAt: Date.now() + TTL_SECONDS * 1000 })
}
