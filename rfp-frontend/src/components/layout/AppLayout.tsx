'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { useSession, signOut } from 'next-auth/react'
import {
  LayoutDashboard, FolderOpen, Database, Settings,
  History, Zap, ChevronRight, Moon, Sun, Menu, X,
  MessageSquare, ClipboardCheck, LogOut, GitBranch, FileText} from 'lucide-react'
import { useTheme } from 'next-themes'
import { useState, useEffect } from 'react'
import { cn } from '@/utils/helpers'
import { useReviewStore, setReviewActor } from '@/stores/reviewStore'
import { useSessionStore } from '@/stores/sessionStore'
import { canAccessRoute, homeRouteFor } from '@/utils/access'
import { BrandLogo } from '@/components/layout/BrandLogo'
import { Users } from 'lucide-react'

const NAV_SECTIONS = [
  {
    label: 'AI',
    items: [
      { href: '/assistant', icon: MessageSquare, label: 'Assistant' },
    ],
  },
  {
    label: 'Workflow',
    items: [
      { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { href: '/workspace', icon: FolderOpen, label: 'Workspace' },
      { href: '/review-queue', icon: ClipboardCheck, label: 'Review Queue', badge: true },
      { href: '/my-submissions', icon: FileText, label: 'My Submissions' },
      { href: '/feedback', icon: GitBranch, label: 'Feedback Loop' },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/knowledge', icon: Database, label: 'Knowledge Base' },
      { href: '/history', icon: History, label: 'History' },
      { href: '/admin/users', icon: Users, label: 'Users', adminOnly: true },
      { href: '/settings', icon: Settings, label: 'Settings' },
    ],
  },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { theme, setTheme } = useTheme()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const { data: session } = useSession()
  const responses = useReviewStore((s) => s.responses)
  const needsReview = responses.filter((r) => r.status === 'needs_review').length
  const me = useSessionStore((s) => s.me)
  const loadMe = useSessionStore((s) => s.load)
  useEffect(() => { if (session?.user) loadMe() }, [session?.user, loadMe])

  // Route guard: once the role is known, bounce users off pages their role
  // can't see (e.g. read-only → Assistant). Backend enforces regardless.
  const router = useRouter()
  useEffect(() => {
    if (me && pathname && !canAccessRoute(me.role, pathname)) {
      router.replace(homeRouteFor(me.role))
    }
  }, [me, pathname, router])

  // Audit-log actor comes from the signed-in user, not a hardcoded name
  useEffect(() => {
    setReviewActor(session?.user?.name)
  }, [session?.user?.name])

  // M4: re-hydrate the review store from the backend once signed in (the
  // initial hydrate runs before the auth token exists).
  useEffect(() => {
    if (session?.user) {
      useReviewStore.persist?.rehydrate?.()
    }
  }, [session?.user])

  useEffect(() => { setMounted(true) }, [])

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className={cn(
        'fixed inset-y-0 left-0 z-50 w-60 flex flex-col',
        'bg-[hsl(var(--sidebar-bg))] border-r border-border/50',
        'transition-transform duration-200 ease-in-out',
        'lg:relative lg:translate-x-0',
        mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      )}>
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-border/50">
          <BrandLogo className="h-9 w-9" />
          <div>
            <div className="text-sm font-semibold text-foreground tracking-tight">Matters AI</div>
            <div className="text-2xs text-muted-foreground tracking-wide">RFP Pilot</div>
          </div>
          <button className="ml-auto lg:hidden text-muted-foreground hover:text-foreground" onClick={() => setMobileOpen(false)}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 overflow-y-auto scrollbar-none space-y-4">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label}>
              <div className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest px-3 mb-1">
                {section.label}
              </div>
              <div className="space-y-0.5">
                {section.items.map(({ href, icon: Icon, label, badge, adminOnly }: { href: string; icon: typeof Settings; label: string; badge?: boolean; adminOnly?: boolean }) => {
                  // Cosmetic gate — every page's API is enforced server-side
                  if (adminOnly && me && me.role !== 'admin') return null
                  if (me && !canAccessRoute(me.role, href)) return null
                  const active = pathname === href || pathname?.startsWith(href + '/')
                  const badgeCount = badge ? needsReview : 0
                  return (
                    <Link key={href} href={href} onClick={() => setMobileOpen(false)}
                      className={cn('sidebar-item', active && 'active')}>
                      <Icon className="w-4 h-4 flex-shrink-0" />
                      <span className="flex-1">{label}</span>
                      {badgeCount > 0 && (
                        <span className="bg-amber-500/20 text-amber-600 dark:text-amber-400 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                          {badgeCount}
                        </span>
                      )}
                      {active && !badgeCount && <ChevronRight className="w-3 h-3 opacity-60" />}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-3 py-3 border-t border-border/50 space-y-1">
          {mounted && (
            <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="sidebar-item w-full">
              {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
            </button>
          )}
          <div className="flex items-center gap-2 px-3 py-2">
            {session?.user?.image
              ? <img src={session.user.image} alt="" className="w-7 h-7 rounded-full object-cover" />
              : <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-semibold text-primary">{session?.user?.name?.[0] ?? 'M'}</div>
            }
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-foreground truncate">{session?.user?.name ?? 'User'}</div>
              <div className="text-[10px] text-muted-foreground truncate">{session?.user?.email ?? ''}</div>
            </div>
            <button onClick={() => signOut({ callbackUrl: '/login' })}
              className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors" title="Sign out">
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="lg:hidden flex items-center gap-3 px-4 py-3 border-b border-border bg-card">
          <button onClick={() => setMobileOpen(true)} className="text-muted-foreground"><Menu className="w-5 h-5" /></button>
          <div className="flex items-center gap-2"><BrandLogo className="h-6 w-6" /><span className="text-sm font-semibold">Matters AI <span className="text-muted-foreground font-normal">· RFP Pilot</span></span></div>
        </div>
        <motion.main key={pathname} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }} className="flex-1 overflow-y-auto">
          {children}
        </motion.main>
      </div>
    </div>
  )
}