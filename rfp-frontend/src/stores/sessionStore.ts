import { create } from 'zustand'
import { getMe, type Me } from '@/services/api'
import { setReviewActor } from '@/stores/reviewStore'

/**
 * Current user's role + capabilities, as resolved by the BACKEND (/me).
 * UI gating reads from here; it is convenience only — every API endpoint
 * re-checks the same capability server-side.
 */
export type Capability =
  | 'generate' | 'correct' | 'approve' | 'kb_read' | 'kb_write'
  | 'export' | 'feedback_read' | 'manage_users' | 'manage_settings'

interface SessionStore {
  me: Me | null
  loading: boolean
  loaded: boolean
  load: () => Promise<void>
  can: (cap: Capability) => boolean
}

export const useSessionStore = create<SessionStore>()((set, get) => ({
  me: null,
  loading: false,
  loaded: false,

  load: async () => {
    if (get().loading || get().loaded) return
    set({ loading: true })
    try {
      const me = await getMe()
      setReviewActor(me.name)
      set({ me, loaded: true })
    } catch {
      // Backend unreachable or auth misconfigured — UI stays ungated;
      // the backend still enforces everything.
      set({ me: null, loaded: true })
    } finally {
      set({ loading: false })
    }
  },

  can: (cap) => {
    const me = get().me
    // Fail-open in the UI before /me loads (backend still enforces);
    // this avoids flashing a locked-down UI on every page load.
    if (!me) return true
    return me.capabilities.includes(cap)
  },
}))
