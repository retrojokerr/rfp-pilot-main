'use client'

import { useSearchParams } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { Zap, AlertCircle } from 'lucide-react'
import { BrandLogo } from '@/components/layout/BrandLogo'

const ERROR_MESSAGES: Record<string, string> = {
  AccessDenied: 'This account is not authorised. Contact your admin for access.',
  OAuthSignin:  'Something went wrong during sign-in. Please try again.',
  OAuthCallback:'Something went wrong. Please try again.',
  Default:      'An error occurred. Please try again.',
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  )
}

export default function LoginClient() {
  const params = useSearchParams()
  const error = params.get('error')
  const [loading, setLoading] = useState(false)

  async function handleSignIn() {
    setLoading(true)
    await signIn('google', { callbackUrl: '/dashboard' })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="absolute inset-0 bg-grid-pattern bg-grid opacity-40 pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="relative w-full max-w-sm"
      >
        <div className="bg-card border border-border rounded-2xl p-8 shadow-xl">
          <div className="flex items-center gap-3 mb-8">
            <BrandLogo className="h-10 w-10" />
            <div>
              <div className="text-base font-semibold tracking-tight">Matters AI</div>
              <div className="text-[11px] text-muted-foreground">RFP Pilot</div>
            </div>
          </div>

          <h1 className="text-xl font-semibold mb-1">Sign in</h1>
          <p className="text-sm text-muted-foreground mb-6">
            Sign in with your Google account to continue.
          </p>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-start gap-2.5 p-3 rounded-lg bg-destructive/10 border border-destructive/20 mb-5"
            >
              <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
              <p className="text-sm text-destructive">
                {ERROR_MESSAGES[error] ?? ERROR_MESSAGES.Default}
              </p>
            </motion.div>
          )}

          <button
            onClick={handleSignIn}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-xl border border-border bg-background hover:bg-muted transition-colors text-sm font-medium disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading
              ? <div className="w-4 h-4 border-2 border-muted-foreground border-t-foreground rounded-full animate-spin" />
              : <GoogleIcon />
            }
            {loading ? 'Redirecting...' : 'Continue with Google'}
          </button>

          <p className="text-[11px] text-muted-foreground text-center mt-4">
            Access is limited to authorised accounts.
          </p>
        </div>

        <p className="text-center text-[11px] text-muted-foreground mt-4">
          Matters.ai · RFP Automation Platform
        </p>
      </motion.div>
    </div>
  )
}