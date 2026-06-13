/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',

  // H4: Security headers on every response
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          // Prevent clickjacking
          { key: 'X-Frame-Options', value: 'DENY' },
          // Stop MIME sniffing
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // No referrer to external sites
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Force HTTPS (1 year, include subdomains) — browser ignores on HTTP
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          // Permissions policy — deny unused APIs
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // CSP: tight policy for the app (adjust script-src if you add CDN scripts)
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",  // unsafe-eval needed by Next.js dev
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://lh3.googleusercontent.com",  // Google avatar
              "connect-src 'self' " + (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'),
              "font-src 'self'",
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
    ]
  },
}

module.exports = nextConfig
