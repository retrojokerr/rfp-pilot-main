# RFP Pilot — Frontend

Enterprise-grade RFP/RFI response automation platform built with Next.js 15.

## Quick Start

```bash
# Install dependencies
npm install

# Start dev server
npm run dev
```

Open http://localhost:3000 → redirects to `/dashboard`

## Requirements

- Node.js 18+
- Your Python FastAPI backend running on `http://localhost:8000`
  ```bash
  cd ~/rfi-bot\ copy
  source venv/bin/activate
  uvicorn api:app --reload --port 8000
  ```

## Pages

| Route | Description |
|---|---|
| `/dashboard` | Overview stats, recent projects, activity timeline |
| `/workspace` | 4-step wizard: Upload → Map → Select → Generate |
| `/knowledge` | Knowledge base document management |
| `/history` | Past generation sessions |
| `/settings` | API config, generation preferences |

## Workflow

1. **Upload** — Drop any `.xlsx`, `.xls`, or `.csv` file
2. **Map columns** — Auto-detected, fix if wrong. Clear separation of Question / Section / Skip columns
3. **Select rows** — Check rows to answer, bulk-select by security/compliance keywords
4. **Generate** — Calls `POST /answer` per row, streams results with confidence scores

## Environment Variables

```env
# .env.local
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## Deploy to Vercel

```bash
npm i -g vercel
vercel
```

Set `NEXT_PUBLIC_API_URL` to your deployed API URL in Vercel's environment variables.

## Tech Stack

- **Next.js 15** + App Router + TypeScript
- **TailwindCSS** + custom design tokens
- **Framer Motion** — step transitions, card animations
- **TanStack Table** — virtualized, filterable selection table
- **SheetJS** — client-side workbook parsing (no server upload needed)
- **react-dropzone** — drag & drop file upload
- **Zustand** — wizard state management
- **next-themes** — dark/light mode
- **sonner** — toast notifications
