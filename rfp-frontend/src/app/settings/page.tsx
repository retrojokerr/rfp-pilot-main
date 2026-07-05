'use client'

import { useState, useEffect } from 'react'
import { fetchModelInfo, type ModelInfo } from '@/services/api'
import { motion } from 'framer-motion'
import { Save, TestTube, CheckCircle2, XCircle, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { cn, getAppSettings, saveAppSettings } from '@/utils/helpers'

const DEFAULT_API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000'

export default function SettingsPage() {
  const [apiUrl, setApiUrl] = useState(DEFAULT_API)
  const [groqKey, setGroqKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [delay, setDelay] = useState(350)
  const [maxBatch, setMaxBatch] = useState(20)
  const [apiStatus, setApiStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle')
  const [vectors, setVectors] = useState<number | null>(null)
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null)
  useEffect(() => { fetchModelInfo().then(setModelInfo).catch(() => {}) }, [])

  // Load persisted settings on mount — previously this page showed
  // hardcoded defaults and "Save" was a no-op toast.
  useEffect(() => {
    const s = getAppSettings()
    if (s.apiUrl) setApiUrl(s.apiUrl)
    setDelay(s.requestDelayMs)
    setMaxBatch(s.maxBatch)
  }, [])

  async function testConnection() {
    setApiStatus('testing')
    const base = apiUrl.replace(/\/+$/, '')
    try {
      // Prefer the lightweight /health endpoint, fall back to /knowledge
      let r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) }).catch(() => null)
      if (!r || !r.ok) {
        r = await fetch(`${base}/knowledge`, { signal: AbortSignal.timeout(5000) })
      }
      if (r.ok) {
        const d = await r.json().catch(() => ({}))
        setVectors(d.vector_count ?? d.points_count ?? null)
        setApiStatus('ok')
        toast.success('Connected successfully')
      } else {
        setApiStatus('error')
        toast.error(`HTTP ${r.status}`)
      }
    } catch {
      setApiStatus('error')
      toast.error('Cannot reach API. Is uvicorn running?')
    }
  }

  function save() {
    saveAppSettings({
      apiUrl: apiUrl.replace(/\/+$/, ''),
      requestDelayMs: delay,
      maxBatch,
    })
    toast.success('Settings saved', {
      description: 'New requests now use these values — no reload needed.',
    })
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Configure your API connection and generation preferences.</p>
      </div>

      {/* API Configuration */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-card border border-border rounded-xl p-5 space-y-4"
      >
        <h2 className="text-sm font-semibold">API Configuration</h2>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Backend URL</label>
          <div className="flex gap-2">
            <input
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder={DEFAULT_API}
              className="flex-1 px-3 py-2 text-sm bg-muted/40 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50 font-mono transition-all"
            />
            <button
              onClick={testConnection}
              disabled={apiStatus === 'testing'}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            >
              <TestTube className="w-4 h-4" />
              Test
            </button>
          </div>
          {apiStatus === 'ok' && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Connected{vectors !== null && ` · ${vectors} vectors loaded`}
            </p>
          )}
          {apiStatus === 'error' && (
            <p className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1.5">
              <XCircle className="w-3.5 h-3.5" />
              Cannot reach API — make sure uvicorn is running
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">AI Model (server-side)</label>
          <div className="px-3 py-2 text-sm bg-muted/40 border border-border rounded-lg font-mono">
            {modelInfo
              ? `${modelInfo.model}  ·  ${modelInfo.provider}  ·  ${modelInfo.masked_key}`
              : '—'}
          </div>
          <p className="text-[10px] text-muted-foreground">
            The model this instance is running, resolved from backend config.
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Groq API Key (server-side only)</label>
          <div className="relative">
            <input
              type={showKey ? 'text' : 'password'}
              value={groqKey}
              onChange={(e) => setGroqKey(e.target.value)}
              placeholder="gsk_..."
              disabled
              className="w-full px-3 py-2 pr-10 text-sm bg-muted/40 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 font-mono transition-all opacity-60 cursor-not-allowed"
            />
            <button
              onClick={() => setShowKey(!showKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            For security, model API keys are configured only on the backend via its .env file — they are never stored in the browser.
          </p>
        </div>
      </motion.section>

      {/* Generation settings */}
      <motion.section
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="bg-card border border-border rounded-xl p-5 space-y-4"
      >
        <h2 className="text-sm font-semibold">Generation</h2>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">Delay between API calls (ms)</label>
            <span className="text-xs font-mono text-foreground">{delay}ms</span>
          </div>
          <input
            type="range"
            min={0} max={2000} step={50}
            value={delay}
            onChange={(e) => setDelay(Number(e.target.value))}
            className="w-full accent-primary"
          />
          <p className="text-[10px] text-muted-foreground">Increase if hitting Groq rate limits</p>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-muted-foreground">Max batch size per request</label>
            <span className="text-xs font-mono text-foreground">{maxBatch}</span>
          </div>
          <input
            type="range"
            min={5} max={50} step={5}
            value={maxBatch}
            onChange={(e) => setMaxBatch(Number(e.target.value))}
            className="w-full accent-primary"
          />
        </div>
      </motion.section>

      <div className="flex justify-end">
        <button
          onClick={save}
          className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <Save className="w-4 h-4" />
          Save settings
        </button>
      </div>
    </div>
  )
}
