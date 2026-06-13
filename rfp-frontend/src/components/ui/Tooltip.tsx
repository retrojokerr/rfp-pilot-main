'use client'

import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/utils/helpers'

interface TooltipProps {
  content: string
  children: React.ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
  className?: string
}

export function Tooltip({ content, children, side = 'top', className }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const [coords, setCoords] = useState({ x: 0, y: 0 })
  const ref = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  function show() {
    clearTimeout(timer.current)
    if (!ref.current) return
    const rect = ref.current.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    let y = 0
    if (side === 'top') y = rect.top - 8
    else if (side === 'bottom') y = rect.bottom + 8
    else if (side === 'left') y = rect.top + rect.height / 2
    else y = rect.top + rect.height / 2
    setCoords({ x, y })
    setVisible(true)
  }

  function hide() {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setVisible(false), 80)
  }

  useEffect(() => () => clearTimeout(timer.current), [])

  const tooltipStyle: React.CSSProperties =
    side === 'top'    ? { position: 'fixed', left: coords.x, top: coords.y, transform: 'translate(-50%, -100%)' } :
    side === 'bottom' ? { position: 'fixed', left: coords.x, top: coords.y, transform: 'translate(-50%, 0)' } :
    side === 'left'   ? { position: 'fixed', left: coords.x, top: coords.y, transform: 'translate(-100%, -50%)' } :
                        { position: 'fixed', left: coords.x, top: coords.y, transform: 'translate(0, -50%)' }

  return (
    <div
      ref={ref}
      className={cn('relative inline-flex', className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {mounted && createPortal(
        <AnimatePresence>
          {visible && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.1, ease: 'easeOut' }}
              style={{ ...tooltipStyle, zIndex: 9999, pointerEvents: 'none' }}
            >
              <div className="bg-zinc-800 dark:bg-zinc-700 text-white text-[11px] font-medium px-2.5 py-1.5 rounded-lg shadow-lg whitespace-nowrap">
                {content}
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  )
}