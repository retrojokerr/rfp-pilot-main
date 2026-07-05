import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],

  callbacks: {
    async signIn({ user, profile }) {
      const email = (user?.email || profile?.email || '').toLowerCase()
      if (!email) return false

      // Domain policy: production requires @matters.ai. Local dev with
      // ALLOW_ANY_GOOGLE=true skips the domain check (allowlist still applies).
      const localBypass =
        process.env.NODE_ENV === 'development' && process.env.ALLOW_ANY_GOOGLE === 'true'
      if (!localBypass && !email.endsWith('@matters.ai')) return false

      // Closed allowlist: the backend is the source of truth (ADMIN_EMAILS
      // union the users registry). Deny anyone not on it. Fail CLOSED — any
      // error or non-OK response denies the sign-in rather than letting an
      // unverified user through. Denied users land on /login?error=AccessDenied.
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/auth/check-access?email=${encodeURIComponent(email)}`,
          { cache: 'no-store' },
        )
        if (!res.ok) return false
        const data = await res.json()
        return data?.allowed === true
      } catch {
        return false
      }
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.email = token.email as string
        session.user.name  = token.name  as string
        session.user.image = token.picture as string
      }
      return session
    },

    async jwt({ token, profile }) {
      if (profile) {
        token.email   = profile.email
        token.name    = profile.name
        token.picture = (profile as { picture?: string }).picture
      }
      return token
    },
  },

  pages: {
    signIn:  '/login',
    error:   '/login',   // Redirect errors back to login page with ?error=
  },
})