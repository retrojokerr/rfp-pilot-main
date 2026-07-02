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
      // Local dev only: allow any Google account for multi-user testing.
      // Production (NODE_ENV=production) always enforces the @matters.ai domain.
      if (process.env.NODE_ENV === 'development' && process.env.ALLOW_ANY_GOOGLE === 'true') {
        return true
      }
      return email.endsWith('@matters.ai')
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