# Matters AI · RFP Pilot

An internal tool that answers RFP / RFI / security questionnaires from a
company knowledge base, then routes the drafted answers through a human
review workflow before exporting them back into the original spreadsheet —
faithfully, in place.

Upload a questionnaire → the system parses the questions → a retrieval-augmented
generation (RAG) pipeline drafts each answer with a confidence score and cited
sources → a reviewer edits/approves → the approved answers are written back into
the *original* workbook (same sheets, rows, and layout) for return to the
requester.

> **New here?** The one-page tour is below. For everything else — architecture,
> data model, the full API, the deploy runbook, and known caveats — see
> **[ARCHITECTURE.md](./ARCHITECTURE.md)**.

---

## What it does

- **Answer generation** — parses xlsx/xls/csv questionnaires, extracts questions,
  and drafts an `AVAILABILITY` (Yes/No/Partial) + `REMARKS` answer for each, with
  a confidence score and the source documents it drew from.
- **Tiered RAG retrieval** — human-verified corrections ("golden answers") are
  matched first and can short-circuit the answer; otherwise the knowledge-base
  documents are retrieved and ranked by semantic similarity + recency.
- **Human review workflow** — answers are submitted per-sheet for review;
  reviewers can accept, edit, flag, or reject each item, then approve or send
  back the whole submission. Resubmissions keep a cycle/lineage chain.
- **Faithful export** — approved answers are written back into the exact
  (sheet, row, column) position they came from in the uploaded workbook, so the
  returned file matches the requester's original format.
- **Feedback loop** — approvals and corrections become "golden answers" ingested
  into the vector store, so the system improves as it's used. A Slack bot offers
  the same Q&A with 👍/👎 feedback capture.
- **In-app notifications + live refresh** — reviewers are notified of new
  submissions; submitters of approvals/send-backs. Pages poll and refresh
  themselves without manual reloads.
- **Closed-allowlist access control** — only explicitly allowlisted emails
  (registry + bootstrap admins) can sign in; role-based capabilities gate every
  endpoint.

---

## Tech stack

| Layer | Technology |
|---|---|
| **Frontend** | Next.js 15 (App Router), React 19, TypeScript, Tailwind, Radix UI, Zustand, TanStack Query/Table/Virtual, framer-motion |
| **Auth** | NextAuth v5 (Google OAuth), JWT (HS256) shared with the backend |
| **Backend** | FastAPI, Uvicorn, SQLModel, Alembic, slowapi (rate limiting), PyJWT |
| **Database** | PostgreSQL (Neon) |
| **Vector store** | Qdrant Cloud |
| **Embeddings** | `BAAI/bge-small-en-v1.5` (384-dim) via sentence-transformers (local, CPU) |
| **LLM** | Groq (`meta-llama/llama-4-scout-17b-16e-instruct`) |
| **Parsing/Export** | openpyxl, python-docx, pandas, pdfplumber |
| **Slack** | slack-bolt (Socket Mode) |
| **Deploy** | Docker, GitHub Actions → GHCR, AWS EC2, Caddy (TLS + reverse proxy), Doppler (secrets) |

---

## Architecture at a glance

```
                          ┌────────────────────────────────────────┐
   Browser ── HTTPS ──►   │  Caddy (TLS, reverse proxy)             │
                          │   /api/auth/*  → frontend (NextAuth)    │
                          │   /api/*       → backend (prefix strip) │
                          │   /*           → frontend               │
                          └───────────┬───────────────┬────────────┘
                                      │               │
                          ┌───────────▼──┐   ┌────────▼─────────────┐
                          │  Frontend    │   │  Backend (FastAPI)   │
                          │  Next.js 15  │   │  RAG + review + auth │
                          └──────────────┘   └───┬──────┬──────┬────┘
                                                 │      │      │
                                    ┌────────────▼─┐ ┌──▼───┐ ┌▼─────────┐
                                    │ Postgres     │ │Qdrant│ │ Groq LLM │
                                    │ (Neon)       │ │Cloud │ │          │
                                    └──────────────┘ └──────┘ └──────────┘
   Slack ── Socket Mode ──► Slack bot (same backend image) ──► Qdrant + Groq
```

Full request flows and the RAG pipeline are documented in
[ARCHITECTURE.md](./ARCHITECTURE.md#request-flows).

---

## Quick start (local development)

**Prerequisites:** Python 3.11+, Node 18+, a Neon Postgres URL, a Qdrant Cloud
URL + key, a Groq API key, and a Google OAuth client.

### 1. Backend

```bash
cd rfp-backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# create rfp-backend/.env (see ARCHITECTURE.md for the full variable list)
#   DATABASE_URL=postgresql://...?sslmode=require
#   QDRANT_URL=... / QDRANT_API_KEY=...
#   GROQ_API_KEY=... / LLM_PROVIDER=groq / LLM_MODEL=meta-llama/llama-4-scout-17b-16e-instruct
#   API_JWT_SECRET=<same value the frontend uses>
#   ADMIN_EMAILS=you@yourcompany.com

# apply migrations
alembic upgrade head

# run
uvicorn api:app --host 0.0.0.0 --port 8000 --reload
```

### 2. Frontend

```bash
cd rfp-frontend
npm install

# create rfp-frontend/.env.local
#   NEXTAUTH_SECRET=... / NEXTAUTH_URL=http://localhost:3000
#   GOOGLE_CLIENT_ID=... / GOOGLE_CLIENT_SECRET=...
#   NEXT_PUBLIC_API_URL=http://localhost:8000
#   API_JWT_SECRET=<same value the backend uses>
#   ALLOW_ANY_GOOGLE=true      # local only — lets non-@company Google accounts sign in
#   NODE_ENV=development

npm run dev
```

Open http://localhost:3000. Sign in with a Google account. To be granted access
you must either be listed in `ADMIN_EMAILS` or be added to the users registry via
the in-app **Users** page (see access control in
[ARCHITECTURE.md](./ARCHITECTURE.md#access-control)).

### 3. Slack bot (optional)

```bash
cd rfp-backend
# needs SLACK_BOT_TOKEN + SLACK_APP_TOKEN in the environment
# for local runs outside Docker, also set API_URL=http://localhost:8000
python3 bot.py
```

---

## Deploy (condensed)

Deployment is **build-in-CI, pull-on-server**. Pushing to `main` triggers a
GitHub Actions workflow that builds the backend and frontend Docker images and
pushes them to GHCR. A person then pulls and restarts on the EC2 host.

```bash
# 1. Ship code
git push origin main               # → GitHub Actions builds + pushes images to GHCR

# 2. On the EC2 host (after the Actions run goes green)
cd /home/ubuntu/rfp-deploy
export DOPPLER_TOKEN="<prd service token>"
doppler run -- docker compose pull
doppler run -- docker compose up -d
docker image prune -f              # reclaim old image layers
docker compose ps                  # confirm all healthy
```

> ⚠️ **Read the full runbook before deploying.** There are real gotchas — a tight
> disk vs. a large backend image, a Caddy routing collision, secret-injection
> details, and migration handling — all documented in
> **[ARCHITECTURE.md → Deployment](./ARCHITECTURE.md#deployment)**. The condensed
> steps above assume that setup is already in place.

---

## Repository layout

```
rfp-pilot-main/
├── rfp-backend/          FastAPI app
│   ├── api.py            main app, most endpoints, upload/parse/export
│   ├── review_workflow.py  review submission router (submit/review/approve/export/notify)
│   ├── retriever.py      RAG: tiered retrieval + answer generation (ask())
│   ├── ingest.py         Qdrant client + document/correction ingestion
│   ├── confidence.py     confidence scoring
│   ├── parser.py         xlsx/csv question extraction
│   ├── auth.py           roles, capabilities, JWT verification, allowlist
│   ├── models.py         SQLModel tables
│   ├── database.py       engine + table creation
│   ├── bot.py            Slack bot
│   ├── alembic/          migrations
│   └── Dockerfile
├── rfp-frontend/         Next.js app
│   ├── src/app/          pages (dashboard, workspace, review-queue, my-submissions, admin/users, ...)
│   ├── src/auth.ts       NextAuth config + signIn allowlist gate
│   ├── src/services/     API client
│   ├── src/stores/       Zustand stores
│   ├── src/hooks/        useAutoRefresh, etc.
│   └── Dockerfile
├── docker-compose.yml    (deploy copy lives on the EC2 at /home/ubuntu/rfp-deploy/)
├── .github/workflows/    docker-build.yml (CI)
├── README.md             this file
└── ARCHITECTURE.md       detailed documentation
```

---

## License / status

Internal pilot. Not for external distribution.
