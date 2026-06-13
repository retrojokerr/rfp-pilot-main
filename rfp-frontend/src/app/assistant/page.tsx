'use client'

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Send, Sparkles, ThumbsUp, ThumbsDown, Copy,
  BookmarkPlus, ChevronDown, ChevronRight, MessageSquare,
  Pin, Trash2, Plus, BarChart3,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/utils/helpers'
import { useChatStore } from '@/stores/chatStore'
import { useFeedbackStore } from '@/stores/feedbackStore'
import { generateAnswer, parseApiError, ingestCorrection } from '@/services/api'
import { useSessionStore } from '@/stores/sessionStore'
import type { ChatMessage } from '@/types'

const SUGGESTED = [
  { icon: '🔒', text: 'Does the platform support endpoint DLP?' },
  { icon: '☁️', text: 'How does deployment work for air-gapped environments?' },
  { icon: '📋', text: 'Generate a response for SOC2 logging requirements' },
  { icon: '🔗', text: 'What SIEM integrations are supported?' },
  { icon: '🏷️', text: 'Explain the data classification architecture' },
  { icon: '🔐', text: 'Describe encryption-at-rest implementation' },
]

// ── Message bubble ─────────────────────────────────────────────

function MsgBubble({
  msg, threadId, question,
}: {
  msg: ChatMessage
  threadId: string
  question?: string
}) {
  const setFeedback = useChatStore((s) => s.setFeedback)
  const canCorrect = useSessionStore((s) => s.can('correct'))
  const [srcOpen, setSrcOpen] = useState(false)
  const [askCorrect, setAskCorrect] = useState(false)  // show "want to correct?" prompt
  const [correcting, setCorrecting] = useState(false)   // show correction textarea
  const [correction, setCorrection] = useState('')
  const isUser = msg.role === 'user'

  async function submitCorrection() {
    if (!correction.trim() || !question) return
    const correctionText = correction.trim()

    // 1. Store locally
    useFeedbackStore.getState().capture({
      question,
      section: '',
      badAnswer: msg.content,
      goodAnswer: correctionText,
      availability: 'Unknown',
      confidence: msg.confidence?.score ?? 0,
      signal: 'thumbs_down',
      source: 'assistant',
    })

    setCorrecting(false)
    setCorrection('')

    // 2. Ingest into Qdrant so future answers improve immediately
    try {
      await ingestCorrection({
        question,
        good_answer: correctionText,
        section: '',
        source: 'assistant',
      })
      toast.success('Correction ingested into knowledge base', {
        description: 'Future answers to this question will use your correction',
      })
    } catch {
      toast.success('Correction saved locally', {
        description: 'Could not reach backend to ingest — will apply on next sync',
      })
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn('flex gap-3', isUser ? 'justify-end' : 'justify-start')}
    >
      {!isUser && (
        <div className="w-7 h-7 rounded-lg bg-primary/15 border border-primary/20 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
        </div>
      )}

      <div className={cn('max-w-[80%] space-y-1.5', isUser && 'items-end flex flex-col')}>
        <div className={cn(
          'px-4 py-3 rounded-2xl text-sm leading-relaxed',
          isUser
            ? 'bg-primary text-primary-foreground rounded-tr-sm'
            : 'bg-card border border-border rounded-tl-sm'
        )}>
          {msg.status === 'streaming' ? (
            <span className="flex items-center gap-2 text-muted-foreground">
              Thinking
              <span className="flex gap-0.5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-1 h-1 rounded-full bg-primary animate-bounce"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </span>
            </span>
          ) : (
            <div className="whitespace-pre-wrap">{msg.content}</div>
          )}
        </div>

        {!isUser && msg.status === 'done' && (
          <div className="flex items-center gap-1.5 px-1 flex-wrap">
            {msg.confidence && (
              <span className={cn(
                'inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border',
                msg.confidence.label === 'high'
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400'
                  : msg.confidence.label === 'medium'
                  ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400'
                  : 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-700 dark:text-red-400'
              )}>
                <BarChart3 className="w-2.5 h-2.5" />
                {Math.round(msg.confidence.score * 100)}%
              </span>
            )}

            {(msg.sources?.length ?? 0) > 0 && (
              <button
                onClick={() => setSrcOpen(!srcOpen)}
                className="text-[10px] text-muted-foreground hover:text-foreground flex items-center gap-0.5 transition-colors"
              >
                {msg.sources!.length} sources
                {srcOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              </button>
            )}

            <div className="flex items-center gap-0.5 ml-auto">
              <button
                onClick={() => { navigator.clipboard.writeText(msg.content); toast.success('Copied') }}
                className="p-1 rounded text-muted-foreground hover:text-foreground"
              >
                <Copy className="w-3 h-3" />
              </button>
              <button
                onClick={() => {
                  setFeedback(threadId, msg.id, 'up')
                  if (question) {
                    useFeedbackStore.getState().capture({
                      question, section: '', badAnswer: '', goodAnswer: msg.content,
                      availability: 'Unknown', confidence: msg.confidence?.score ?? 0,
                      signal: 'thumbs_up', source: 'assistant',
                    })
                  }
                }}
                className={cn('p-1 rounded', msg.feedback === 'up' ? 'text-emerald-500' : 'text-muted-foreground hover:text-foreground')}
              >
                <ThumbsUp className="w-3 h-3" />
              </button>
              <button
                onClick={() => {
                  setFeedback(threadId, msg.id, 'down')
                  setAskCorrect((prev) => !prev)
                  setCorrecting(false)
                }}
                className={cn('p-1 rounded', msg.feedback === 'down' ? 'text-red-500' : 'text-muted-foreground hover:text-foreground')}
                title="Flag as incorrect"
              >
                <ThumbsDown className="w-3 h-3" />
              </button>
              <button
                onClick={() => toast.success('Saved to workspace')}
                className="p-1 rounded text-muted-foreground hover:text-primary"
              >
                <BookmarkPlus className="w-3 h-3" />
              </button>
            </div>
          </div>
        )}

        <AnimatePresence>
          {srcOpen && msg.sources && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="bg-muted/40 border border-border rounded-xl p-3 space-y-1.5">
                {msg.sources.map((s, i) => (
                  <div key={i} className="text-xs font-mono text-muted-foreground">{s.filename}</div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {askCorrect && !correcting && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 rounded-lg border border-border">
                <span className="text-xs text-muted-foreground flex-1">Want to provide the correct answer?</span>
                {canCorrect && (
                <button
                  onClick={() => { setCorrecting(true); setAskCorrect(false) }}
                  className="px-2.5 py-1 rounded-lg bg-amber-500 text-white text-xs font-medium hover:opacity-90"
                >
                  Yes
                </button>
                )}
                <button
                  onClick={() => setAskCorrect(false)}
                  className="px-2.5 py-1 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground"
                >
                  No
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {correcting && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
                    What should the answer have been?
                  </p>
                  <button onClick={() => { setCorrecting(false); setAskCorrect(false) }} className="text-amber-400 hover:text-amber-600 text-xs">✕</button>
                </div>
                <textarea
                  value={correction}
                  onChange={(e) => setCorrection(e.target.value)}
                  placeholder="Type the correct answer..."
                  rows={3}
                  className="w-full text-xs bg-white dark:bg-zinc-900 border border-amber-200 dark:border-amber-800 rounded-lg p-2 focus:outline-none resize-none"
                />
                <div className="flex gap-2">
                  <button
                    onClick={submitCorrection}
                    className="px-3 py-1 rounded-lg bg-amber-500 text-white text-xs font-medium hover:opacity-90"
                  >
                    Submit correction
                  </button>
                  <button
                    onClick={() => { setCorrecting(false); setAskCorrect(false) }}
                    className="px-3 py-1 rounded-lg border border-border text-xs text-muted-foreground"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {isUser && (
        <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-semibold text-primary flex-shrink-0 mt-0.5">
          <UserInitials />
        </div>
      )}
    </motion.div>
  )
}

function UserInitials() {
  const me = useSessionStore((s) => s.me)
  const name = me?.name || me?.email || ''
  const initials = name
    .split(/[\s.@_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('') || '·'
  return <>{initials}</>
}

// ── Main page ──────────────────────────────────────────────────

export default function AssistantPage() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Start a FRESH conversation on every visit to the Assistant page.
  // Previous chats remain available in the CHATS list on the left —
  // this only clears the active thread so the page opens clean.
  useEffect(() => {
    useChatStore.setState({ activeThreadId: null })
  }, [])

  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const store = useChatStore()
  const activeThread = store.threads.find((t) => t.id === store.activeThreadId) ?? null
  const showWelcome = !activeThread || activeThread.messages.length === 0

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeThread?.messages.length])

  async function send(text: string) {
    const q = text.trim()
    if (!q || q.length < 2 || loading) return

    let tid = useChatStore.getState().activeThreadId
    if (!tid) {
      tid = useChatStore.getState().createThread()
    }

    setInput('')
    setLoading(true)

    useChatStore.getState().addUserMessage(tid, q)
    const mid = useChatStore.getState().addAssistantMessage(tid, '')

    try {
      const r = await generateAnswer({ question: q })
      useChatStore.getState().updateMessage(tid, mid, {
        content: `${r.availability}\n\n${r.remarks}`,
        status: 'done',
        confidence: r.confidence,
        sources: r.sources.map((s) => ({ filename: s, snippet: '', score: 0 })),
      })
    } catch (err) {
      const msg = parseApiError(err)
      useChatStore.getState().updateMessage(tid, mid, {
        content: msg.includes('429') || msg.includes('Rate limit')
          ? '⚠️ Rate limit reached. Please wait a few minutes and try again.'
          : `Failed: ${msg}`,
        status: 'error',
      })
    } finally {
      setLoading(false)
    }
  }

  if (!mounted) return (
    <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
      <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin mr-2" />
      Loading...
    </div>
  )

  return (
    <div className="h-full flex overflow-hidden">
      {/* Thread sidebar */}
      <div className="w-56 flex-shrink-0 border-r border-border flex flex-col bg-card/50">
        <div className="flex items-center justify-between px-3 py-3 border-b border-border">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Chats</span>
          <button
            onClick={() => {
              const id = useChatStore.getState().createThread()
              useChatStore.getState().setActiveThread(id)
            }}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto py-1 px-2 space-y-0.5">
          {store.threads.map((t) => (
            <div
              key={t.id}
              onClick={() => useChatStore.getState().setActiveThread(t.id)}
              className={cn(
                'flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer group transition-colors',
                t.id === store.activeThreadId
                  ? 'bg-primary/10 text-foreground'
                  : 'hover:bg-muted text-muted-foreground'
              )}
            >
              <MessageSquare className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="flex-1 text-xs truncate">{t.title}</span>
              <div className="hidden group-hover:flex gap-0.5">
                <button
                  onClick={(e) => { e.stopPropagation(); useChatStore.getState().pinThread(t.id) }}
                  className="p-0.5 rounded hover:bg-muted"
                >
                  <Pin className="w-3 h-3" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); useChatStore.getState().deleteThread(t.id) }}
                  className="p-0.5 rounded text-red-500"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))}
          {store.threads.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">No conversations yet</p>
          )}
        </div>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          {showWelcome ? (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center justify-center min-h-[60vh] text-center max-w-lg mx-auto"
            >
              <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-5">
                <Sparkles className="w-6 h-6 text-primary" />
              </div>
              <h2 className="text-xl font-semibold mb-2">RFP Knowledge Assistant</h2>
              <p className="text-sm text-muted-foreground mb-8 leading-relaxed">
                Ask any RFP, security, or compliance question. Answers sourced from your knowledge base.
              </p>
              <div className="grid grid-cols-2 gap-2 w-full">
                {SUGGESTED.map((p) => (
                  <button
                    key={p.text}
                    onClick={() => send(p.text)}
                    className="text-left p-3 rounded-xl border border-border hover:border-primary/30 hover:bg-primary/5 transition-all text-sm text-muted-foreground hover:text-foreground"
                  >
                    <span className="mr-1.5">{p.icon}</span>{p.text}
                  </button>
                ))}
              </div>
            </motion.div>
          ) : (
            activeThread?.messages.map((msg, i) => {
              const prevMsg = i > 0 ? activeThread.messages[i - 1] : null
              const question = msg.role === 'assistant' && prevMsg?.role === 'user'
                ? prevMsg.content
                : undefined
              return (
                <MsgBubble
                  key={msg.id}
                  msg={msg}
                  threadId={activeThread.id}
                  question={question}
                />
              )
            })
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-border bg-background/80 backdrop-blur-sm px-6 py-4">
          <div className="max-w-3xl mx-auto">
            <div className="flex gap-3 items-end bg-card border border-border rounded-2xl px-4 py-3 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/10 transition-all">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    send(input)
                  }
                }}
                placeholder="Ask about capabilities, compliance, integrations..."
                rows={1}
                className="flex-1 bg-transparent text-sm resize-none focus:outline-none placeholder:text-muted-foreground max-h-32"
                onInput={(e) => {
                  const t = e.target as HTMLTextAreaElement
                  t.style.height = 'auto'
                  t.style.height = `${Math.min(t.scrollHeight, 128)}px`
                }}
              />
              <button
                onClick={() => send(input)}
                disabled={!input.trim() || loading}
                className={cn(
                  'w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 transition-all',
                  input.trim() && !loading
                    ? 'bg-primary text-primary-foreground hover:opacity-90'
                    : 'bg-muted text-muted-foreground cursor-not-allowed'
                )}
              >
                {loading
                  ? <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                  : <Send className="w-3.5 h-3.5" />
                }
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground text-center mt-2">
              Enter to send · Shift+Enter for new line
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}