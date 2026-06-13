'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { useState, useCallback } from 'react'
import { Check, Upload, Columns, List, Sparkles } from 'lucide-react'
import { cn } from '@/utils/helpers'
import { useWizardStore } from '@/stores/wizardStore'
import UploadStep from '@/components/upload/UploadStep'
import MappingStep from '@/components/mapping/MappingStep'
import SelectStep from '@/components/mapping/SelectStep'
import GenerateStep from '@/components/generation/GenerateStep'

const STEPS = [
  { id: 'upload',   label: 'Upload',         icon: Upload },
  { id: 'map',      label: 'Map columns',    icon: Columns },
  { id: 'select',   label: 'Select rows',    icon: List },
  { id: 'generate', label: 'Generate',       icon: Sparkles },
] as const

export default function WorkspacePage() {
  const { step, setStep } = useWizardStore()

  const stepIndex = STEPS.findIndex((s) => s.id === step)

  return (
    <div className="min-h-full flex flex-col">

      {/* Step indicator */}
      <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <div className="flex items-center gap-0">
            {STEPS.map((s, i) => {
              const done = i < stepIndex
              const active = i === stepIndex
              const Icon = s.icon
              return (
                <div key={s.id} className="flex items-center flex-1 last:flex-none">
                  <button
                    disabled={!done}
                    onClick={() => done && setStep(s.id)}
                    className={cn(
                      'flex items-center gap-2 group',
                      done && 'cursor-pointer',
                      !done && !active && 'cursor-default'
                    )}
                  >
                    <div className={cn(
                      'w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-all duration-200',
                      done  && 'bg-primary text-primary-foreground',
                      active && 'bg-primary/15 text-primary ring-2 ring-primary/30',
                      !done && !active && 'bg-muted text-muted-foreground'
                    )}>
                      {done ? <Check className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
                    </div>
                    <span className={cn(
                      'text-sm font-medium hidden sm:block transition-colors',
                      active && 'text-foreground',
                      done && 'text-muted-foreground group-hover:text-foreground',
                      !done && !active && 'text-muted-foreground/50'
                    )}>
                      {s.label}
                    </span>
                  </button>
                  {i < STEPS.length - 1 && (
                    <div className={cn('flex-1 h-px mx-3 transition-colors duration-300', done ? 'bg-primary' : 'bg-border')} />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 max-w-5xl mx-auto w-full px-6 py-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="h-full"
          >
            {step === 'upload'   && <UploadStep />}
            {step === 'map'      && <MappingStep />}
            {step === 'select'   && <SelectStep />}
            {step === 'generate' && <GenerateStep />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}