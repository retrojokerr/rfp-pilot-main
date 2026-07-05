'use client'

import { useEffect, useState, useCallback } from 'react'
import { motion } from 'framer-motion'
import { UserPlus, Trash2, ShieldCheck, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/utils/helpers'
import {
  listUsers, upsertUser, removeUser, parseApiError, isForbiddenError,
  type ManagedUser, type Role,
} from '@/services/api'
import { useSessionStore } from '@/stores/sessionStore'

const ROLE_META: Record<Role, { label: string; desc: string; badge: string }> = {
  admin:              { label: 'Admin',              desc: 'Everything, incl. users, KB & settings', badge: 'badge-danger' },
  solutions_engineer: { label: 'Solutions Engineer', desc: 'Run RFIs, generate & edit answers',      badge: 'badge-info' },
  reviewer:           { label: 'Reviewer',           desc: 'Approve / reject / correct answers',     badge: 'badge-warning' },
  readonly:           { label: 'Read-only',          desc: 'View and export approved content',       badge: 'badge-neutral' },
}

export default function UsersAdminPage() {
  const me = useSessionStore((s) => s.me)
  const load = useSessionStore((s) => s.load)
  useEffect(() => { load() }, [load])

  const [users, setUsers] = useState<ManagedUser[]>([])
  const [roles, setRoles] = useState<Role[]>(['admin', 'solutions_engineer', 'reviewer', 'readonly'])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [newEmail, setNewEmail] = useState('')
  const [newRole, setNewRole] = useState<Role>('solutions_engineer')

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listUsers()
      setUsers(data.users)
      setRoles(data.roles)
      setForbidden(false)
    } catch (err) {
      if (isForbiddenError(err)) setForbidden(true)
      else toast.error('Could not load users', { description: parseApiError(err) })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  async function addUser() {
    const email = newEmail.trim().toLowerCase()
    if (!email) return
    try {
      await upsertUser(email, newRole)
      setNewEmail('')
      toast.success(`${email} added as ${ROLE_META[newRole].label}`)
      refresh()
    } catch (err) {
      toast.error('Could not add user', { description: parseApiError(err) })
    }
  }

  async function changeRole(email: string, role: Role) {
    try {
      await upsertUser(email, role)
      toast.success(`${email} → ${ROLE_META[role].label}`)
      refresh()
    } catch (err) {
      toast.error('Could not change role', { description: parseApiError(err) })
    }
  }

  async function drop(email: string) {
    try {
      await removeUser(email)
      toast.success(`${email} removed — they can no longer sign in`)
      refresh()
    } catch (err) {
      toast.error('Could not remove user', { description: parseApiError(err) })
    }
  }

  if (forbidden) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="panel p-10 text-center">
          <ShieldCheck className="w-8 h-8 text-muted-foreground/50 mx-auto mb-3" />
          <p className="text-sm font-medium">Admins only</p>
          <p className="text-xs text-muted-foreground mt-1">
            Your role{me ? ` (${ROLE_META[me.role]?.label ?? me.role})` : ''} doesn't include user management.
            Ask an admin if you need access.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users & roles</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Roles are enforced by the API on every request — this page only edits the registry.
          </p>
        </div>
        <button onClick={refresh} aria-label="Refresh users" className="icon-btn">
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>

      {/* Role legend */}
      <div className="panel divide-y divide-border">
        {roles.map((r) => (
          <div key={r} className="flex items-center gap-3 px-4 py-2.5">
            <span className={cn(ROLE_META[r].badge, 'w-36 justify-center')}>{ROLE_META[r].label}</span>
            <span className="text-xs text-muted-foreground">{ROLE_META[r].desc}</span>
          </div>
        ))}
      </div>

      {/* Add user */}
      <div className="panel p-4">
        <p className="text-2xs font-semibold text-muted-foreground uppercase tracking-wide mb-2.5">Add or update a user</p>
        <div className="flex gap-2 flex-wrap">
          <input
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addUser()}
            placeholder="name@matters.ai"
            aria-label="Email of the user to add"
            className="field flex-1 min-w-52"
          />
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as Role)}
            aria-label="Role for the new user"
            className="field w-52"
          >
            {roles.map((r) => <option key={r} value={r}>{ROLE_META[r].label}</option>)}
          </select>
          <button onClick={addUser} disabled={!newEmail.trim()} className="btn-primary">
            <UserPlus className="w-4 h-4" /> Add
          </button>
        </div>
        <p className="text-2xs text-muted-foreground mt-2">
          Only people listed here (or bootstrap admins set via the ADMIN_EMAILS
          environment variable) can sign in. Anyone else is denied access.
        </p>
      </div>

      {/* User list */}
      <div className="panel divide-y divide-border overflow-hidden">
        {loading && users.length === 0 && (
          <div className="p-4 space-y-2">
            <div className="shimmer h-4 w-2/3" />
            <div className="shimmer h-4 w-1/2" />
          </div>
        )}
        {!loading && users.length === 0 && (
          <p className="p-6 text-center text-sm text-muted-foreground">
            No users added yet — only ADMIN_EMAILS bootstrap admins can sign in.
          </p>
        )}
        {users.map((u, i) => (
          <motion.div
            key={u.email}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.12, delay: Math.min(i * 0.02, 0.2) }}
            className="list-row flex items-center gap-3 px-4 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{u.email}{me?.email === u.email && <span className="text-2xs text-muted-foreground ml-1.5">(you)</span>}</p>
              {u.updated_by && (
                <p className="text-2xs text-muted-foreground">set by {u.updated_by}</p>
              )}
            </div>
            <select
              value={u.role}
              onChange={(e) => changeRole(u.email, e.target.value as Role)}
              disabled={me?.email === u.email}
              aria-label={`Role for ${u.email}`}
              className="field w-48"
            >
              {roles.map((r) => <option key={r} value={r}>{ROLE_META[r].label}</option>)}
            </select>
            <button
              onClick={() => drop(u.email)}
              disabled={me?.email === u.email}
              aria-label={`Remove ${u.email}`}
              className="icon-btn-sm"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
