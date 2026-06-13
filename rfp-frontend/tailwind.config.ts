import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  // Scan ALL of src — class names are also emitted from helpers
  // (availabilityConfig/confidenceBg in src/utils) and stores. The old
  // globs missed src/utils, so any class that only appeared there was
  // tree-shaken out of the build (e.g. badge-success rendered unstyled).
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  // Semantic status classes are part of the design system contract — always
  // ship them, even if a given build composes them dynamically or a helper
  // is the only place a class name appears. Prevents tree-shake regressions.
  safelist: [
    { pattern: /^(text|bg|border)-(success|warning|danger|info)$/ },
    { pattern: /^bg-(success|warning|danger|info)-bg$/ },
    { pattern: /^border-(success|warning|danger|info)-border$/ },
    'badge-success', 'badge-warning', 'badge-danger', 'badge-info', 'badge-neutral',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      // Disciplined type scale. `2xs` (11px) replaces every arbitrary
      // text-[10px] / text-[11px] — do not use arbitrary font sizes.
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.01em' }],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Semantic status colors — single source of truth lives in
        // globals.css as CSS variables (light + dark). The old hardcoded
        // hex palettes (brand/success/warning/danger) had no dark values
        // and zero usages; they are intentionally gone.
        success: {
          DEFAULT: 'hsl(var(--success))',
          bg: 'hsl(var(--success-bg))',
          border: 'hsl(var(--success-border))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          bg: 'hsl(var(--warning-bg))',
          border: 'hsl(var(--warning-border))',
        },
        danger: {
          DEFAULT: 'hsl(var(--danger))',
          bg: 'hsl(var(--danger-bg))',
          border: 'hsl(var(--danger-border))',
        },
        info: {
          DEFAULT: 'hsl(var(--info))',
          bg: 'hsl(var(--info-bg))',
          border: 'hsl(var(--info-border))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-in': {
          from: { opacity: '0', transform: 'translateX(-6px)' },
          to: { opacity: '1', transform: 'translateX(0)' },
        },
        pulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.4' },
        },
      },
      // Motion policy: 120–160ms ease-out, transform/opacity only
      animation: {
        'accordion-down': 'accordion-down 0.15s ease-out',
        'accordion-up': 'accordion-up 0.15s ease-out',
        shimmer: 'shimmer 1.5s linear infinite',
        'fade-in': 'fade-in 0.15s ease-out',
        'slide-in': 'slide-in 0.15s ease-out',
        'pulse-slow': 'pulse 2s ease-in-out infinite',
      },
      boxShadow: {
        // Crisp, restrained depth — no glow, no glass
        'raised': '0 1px 2px rgba(0,0,0,0.04)',
        'overlay': '0 4px 16px rgba(0,0,0,0.10), 0 1px 2px rgba(0,0,0,0.06)',
      },
    },
  },
  plugins: [],
}

export default config
