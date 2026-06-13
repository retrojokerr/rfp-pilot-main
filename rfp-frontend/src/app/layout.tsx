import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { ThemeProvider } from 'next-themes'
import { Toaster } from 'sonner'
import Providers from '@/app/Providers'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const jetbrainsMono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' })

export const metadata: Metadata = {
  title: 'Matters AI · RFP Pilot',
  description: 'Generate accurate, confident RFP/RFI responses from your knowledge base in minutes.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          <Providers>
            {children}
          </Providers>
          <Toaster position="bottom-right" toastOptions={{
            classNames: {
              toast: 'bg-card border border-border text-card-foreground shadow-lg',
              title: 'text-sm font-medium',
              description: 'text-xs text-muted-foreground',
            },
          }} />
        </ThemeProvider>
      </body>
    </html>
  )
}