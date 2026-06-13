import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ChatThread, ChatMessage, ChatSource, ConfidenceScore } from '@/types'

function makeId() { return Math.random().toString(36).slice(2, 10) }
function now() { return new Date().toISOString() }

interface ChatStore {
  threads: ChatThread[]
  activeThreadId: string | null

  // Thread management
  createThread: () => string
  setActiveThread: (id: string) => void
  deleteThread: (id: string) => void
  pinThread: (id: string) => void
  renameThread: (id: string, title: string) => void

  // Messages
  addUserMessage: (threadId: string, content: string) => string
  addAssistantMessage: (threadId: string, content: string, confidence?: ConfidenceScore, sources?: ChatSource[]) => string
  updateMessage: (threadId: string, messageId: string, updates: Partial<ChatMessage>) => void
  setFeedback: (threadId: string, messageId: string, feedback: 'up' | 'down') => void

  // Queries
  getActiveThread: () => ChatThread | null
  getThread: (id: string) => ChatThread | undefined
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      threads: [],
      activeThreadId: null,

      createThread: () => {
        const id = makeId()
        const thread: ChatThread = {
          id, title: 'New conversation',
          messages: [], createdAt: now(), updatedAt: now(), pinned: false,
        }
        set((s) => ({ threads: [thread, ...s.threads], activeThreadId: id }))
        // Zustand set is synchronous — but persist middleware flushes async.
        // Return id immediately; callers must use this id (not read back from state).
        return id
      },

      setActiveThread: (id) => set({ activeThreadId: id }),

      deleteThread: (id) =>
        set((s) => ({
          threads: s.threads.filter((t) => t.id !== id),
          activeThreadId: s.activeThreadId === id ? (s.threads[0]?.id ?? null) : s.activeThreadId,
        })),

      pinThread: (id) =>
        set((s) => ({
          threads: s.threads.map((t) => t.id === id ? { ...t, pinned: !t.pinned } : t),
        })),

      renameThread: (id, title) =>
        set((s) => ({
          threads: s.threads.map((t) => t.id === id ? { ...t, title } : t),
        })),

      addUserMessage: (threadId, content) => {
        const msgId = makeId()
        const msg: ChatMessage = {
          id: msgId, role: 'user', content, status: 'done', createdAt: now(),
        }
        set((s) => {
          const threadExists = s.threads.some((t) => t.id === threadId)
          if (!threadExists) {
            // Thread not in state yet (persist flush lag) — create it now
            const thread: ChatThread = {
              id: threadId, title: content.slice(0, 50),
              messages: [msg], createdAt: now(), updatedAt: now(), pinned: false,
            }
            return { threads: [thread, ...s.threads], activeThreadId: threadId }
          }
          return {
            threads: s.threads.map((t) =>
              t.id !== threadId ? t : {
                ...t,
                messages: [...t.messages, msg],
                updatedAt: now(),
                title: t.messages.length === 0 ? content.slice(0, 50) : t.title,
              }
            ),
          }
        })
        return msgId
      },

      addAssistantMessage: (threadId, content, confidence, sources) => {
        const msgId = makeId()
        const msg: ChatMessage = {
          id: msgId, role: 'assistant', content,
          status: 'streaming', confidence, sources, createdAt: now(),
        }
        set((s) => {
          const threadExists = s.threads.some((t) => t.id === threadId)
          if (!threadExists) {
            const thread: ChatThread = {
              id: threadId, title: 'New conversation',
              messages: [msg], createdAt: now(), updatedAt: now(), pinned: false,
            }
            return { threads: [thread, ...s.threads] }
          }
          return {
            threads: s.threads.map((t) =>
              t.id !== threadId ? t : {
                ...t, messages: [...t.messages, msg], updatedAt: now(),
              }
            ),
          }
        })
        return msgId
      },

      updateMessage: (threadId, messageId, updates) =>
        set((s) => ({
          threads: s.threads.map((t) =>
            t.id !== threadId ? t : {
              ...t,
              messages: t.messages.map((m) => m.id === messageId ? { ...m, ...updates } : m),
            }
          ),
        })),

      setFeedback: (threadId, messageId, feedback) =>
        set((s) => ({
          threads: s.threads.map((t) =>
            t.id !== threadId ? t : {
              ...t,
              messages: t.messages.map((m) => m.id === messageId ? { ...m, feedback } : m),
            }
          ),
        })),

      getActiveThread: () => {
        const { threads, activeThreadId } = get()
        return threads.find((t) => t.id === activeThreadId) ?? null
      },

      getThread: (id) => get().threads.find((t) => t.id === id),
    }),
    { name: 'rfp-chat-store' }
  )
)