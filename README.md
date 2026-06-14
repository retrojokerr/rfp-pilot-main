# Matters AI · RFP Pilot

An enterprise RFP/RFI response platform. Security teams upload questionnaire
spreadsheets, map columns, select rows, and generate AI-drafted answers grounded
in a private knowledge base — then review, correct, and export. Every human
correction is fed back into the knowledge base, so the system gets more accurate
with each questionnaire.

---

## Table of contents

- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [How it works](#how-it-works)
- [Repository layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Configuration](#configuration)
- [Local development](#local-development)
- [Secrets management (Doppler)](#secrets-management-doppler)
- [Deployment](#deployment)
- [Roles &amp; permissions](#roles--permissions)
- [Switching the LLM provider](#switching-the-llm-provider)
- [Security](#security)
- [Troubleshooting](#troubleshooting)

---

## Architecture

Three containers. The two backend containers share **one image** — they differ
only in the command they run (the API server vs. the Slack bot).

```
                 ┌──────────────┐      ┌──────────────┐
  browser  ─────▶│   frontend   │─────▶│  backend-api │─────▶ Qdrant Cloud
                 │  (Next.js)   │      │  (FastAPI)   │       (vector search)
                 │   :3000      │      │   :8000      │            ▲
                 └──────────────┘      └──────┬───────┘            │
                        │                     │            shared knowledge base
                  Google OAuth          ┌─────┴─────┐              │
                  (NextAuth)           Groq/Claude  Google Drive   │
                                        (LLM)       (KB source)    │
                                                                   │
                 ┌──────────────┐                                  │
   Slack    ────▶│  slack-bot   │──── corrections ─────────────────┘
                 │  (bot.py)    │     (golden answers)
                 └──────────────┘
                   shares image + feedback volume with backend-api
```

- The **frontend** authenticates the user with Google (NextAuth), mints a
  short-lived JWT, and calls the backend.
- **backend-api** verifies the JWT, resolves the user's role, runs retrieval
  over Qdrant, and calls the configured LLM to draft answers.
- **slack-bot** is the same image run with `command: python3 bot.py`. It listens
  for 👍/👎 reactions and correction replies in Slack and writes them to the
  shared feedback log. Splitting it into its own container means a bot crash
  restarts independently and never affects the API.
- **Qdrant Cloud** stores the knowledge base: document chunks plus human
  corrections ("golden answers") that always outrank raw documents.
- **Google Drive** is the single source of truth for knowledge documents — a
  sync job ingests them into Qdrant.

Both backend containers mount a shared `hf_models` volume (the embedding model
downloads once and is reused) and a shared `feedback_data` volume (corrections
from Slack land in the same log the API reads).

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 (App Router), TypeScript, Tailwind CSS, Zustand, NextAuth v5 |
| Backend | FastAPI, Python 3.12 |
| Vector DB | Qdrant (Cloud) |
| Embeddings | BAAI/bge-small-en-v1.5 (384-dim) |
| LLM | Groq / Anthropic / OpenAI (swappable via env) |
| Auth | Google OAuth → NextAuth → short-lived HS256 JWT |
| Secrets | Doppler |
| CI/CD | GitHub Actions → GitHub Container Registry |

## How it works

1. **Upload** — drop an RFI/RFP spreadsheet (xlsx/xls/csv). The backend
   validates and parses it into questions.
2. **Map** — assign which columns are questions, sections, and where answers go.
3. **Select** — choose which questions to answer (filter by type/section).
4. **Generate** — the engine retrieves relevant knowledge and drafts an answer
   per question, each with a confidence score and source attribution.
5. **Review** — low-confidence answers are routed to a review queue; reviewers
   approve, edit, or reject. Approved answers are what get exported.
6. **Learn** — every correction (from the workspace, the assistant, the review
   queue, or Slack) is ingested as a golden answer, so the next questionnaire
   starts from your team's verified knowledge.

## Repository layout

```
rfp-pilot-main/
├── .github/workflows/
│   └── docker-build.yml        # CI: builds + pushes images to GHCR on push to main
├── rfp-backend/                # FastAPI service
│   ├── api.py                  # API + endpoints (auth, generate, history, sync…)
│   ├── auth.py                 # JWT verification + RBAC capability matrix
│   ├── ingest.py               # Drive → Qdrant ingestion + correction ingestion
│   ├── retriever.py            # retrieval + answer generation
│   ├── llm_provider.py         # provider abstraction (Groq/Claude/OpenAI)
│   ├── bot.py                  # Slack feedback bot (runs as its own container)
│   ├── bootstrap_credentials.py# decodes Google creds from env at boot
│   ├── requirements.txt
│   └── Dockerfile
├── rfp-frontend/               # Next.js app
│   ├── src/app/                # pages: dashboard, workspace, review-queue,
│   │                           #        knowledge, history, feedback, assistant,
│   │                           #        admin/users, settings, login
│   ├── src/stores/             # Zustand stores
│   ├── src/services/api.ts     # authed API client
│   ├── src/middleware.ts       # server-side route role-guard
│   └── Dockerfile
├── docker-compose.yml          # full stack (pulls prebuilt images from GHCR)
└── README.md
```

## Prerequisites

- **Docker** (Engine 24+ with Compose v2) — the only hard requirement for deployment
- For local development without Docker: **Node 20+**, **Python 3.12+**
- A **Qdrant Cloud** cluster (free tier is fine)
- A **Google Cloud** project with OAuth credentials and a Drive service account
- An **LLM API key** (Groq by default)
- A **Doppler** account (recommended for secrets) — or plain `.env` files

## Configuration

All configuration is via environment variables. Two services, two sets:

### Backend

| Variable | Required | Description |
|---|---|---|
| `LLM_PROVIDER` | no | `groq` (default) · `anthropic` · `openai` |
| `LLM_MODEL` | no | model id for the chosen provider |
| `LLM_API_KEY` | yes* | the provider's key (*falls back to `GROQ_API_KEY`) |
| `GROQ_API_KEY` | yes* | legacy/back-compat key |
| `QDRANT_URL` | yes | Qdrant Cloud cluster URL |
| `QDRANT_API_KEY` | yes | Qdrant Cloud API key |
| `API_JWT_SECRET` | yes | shared HS256 secret — **must match the frontend** |
| `ADMIN_EMAILS` | yes | comma-separated bootstrap admin emails |
| `DEFAULT_ROLE` | no | role for unknown users (default `readonly`) |
| `ALLOWED_ORIGINS` | yes | comma-separated CORS origins (no `*` in prod) |
| `DRIVE_FOLDER_ID` | no | Google Drive folder to sync |
| `GOOGLE_CREDENTIALS_B64` | no | base64 of the Drive service-account JSON |
| `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN` | no | Slack correction bot |

### Frontend

| Variable | Required | Description |
|---|---|---|
| `NEXTAUTH_SECRET` | yes | session signing secret — **different** from `API_JWT_SECRET` |
| `NEXTAUTH_URL` | yes | the URL users open in the browser |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | yes | OAuth credentials |
| `NEXT_PUBLIC_API_URL` | yes | backend URL **as seen from the browser** (build-time) |
| `API_JWT_SECRET` | yes | shared HS256 secret — **must match the backend** |

> **Two rules that cause most setup pain:**
> 1. `API_JWT_SECRET` must be byte-identical in both services, and **different**
>    from `NEXTAUTH_SECRET`.
> 2. `NEXT_PUBLIC_API_URL` is baked into the frontend at **build** time —
>    changing it requires rebuilding the frontend image, not just a restart.

## Local development

```bash
git clone https://github.com/retrojokerr/rfp-pilot-main.git
cd rfp-pilot-main

# ── Backend ──
cd rfp-backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
# create .env with the backend variables above, then:
python3 -m uvicorn api:app --host 0.0.0.0 --port 8000 --reload

# ── Frontend (new terminal) ──
cd rfp-frontend
npm install
# create .env.local with the frontend variables above, then:
npm run dev
```

Open http://localhost:3000.

> The first backend start downloads the embedding model (~130 MB), so give it
> a minute.

## Secrets management (Doppler)

This project uses [Doppler](https://doppler.com) so no `.env` files are needed
and secrets live in one audited place.

```bash
# install the CLI (or use brew / the install script)
doppler login

# point a folder at a project/config
cd rfp-backend  && doppler setup   # project: rfp-pilot, config: dev|prd
cd rfp-frontend && doppler setup

# run any command with secrets injected
doppler run -- python3 -m uvicorn api:app --host 0.0.0.0 --port 8000
doppler run -- npm run dev
```

For the Google Drive credentials file, base64-encode it into a secret instead
of committing the file:

```bash
base64 -i credentials.json | tr -d '\n'    # paste result into GOOGLE_CREDENTIALS_B64
```

`bootstrap_credentials.py` decodes it back to `credentials.json` at startup, so
the file never lives in the repo or image.

## Deployment

Images are built automatically by GitHub Actions on every push to `main` and
published to GitHub Container Registry:

```
ghcr.io/retrojokerr/rfp-pilot-backend:latest
ghcr.io/retrojokerr/rfp-pilot-frontend:latest
```

On any server with Docker:

```bash
# 1. Authenticate Doppler with a read-only service token for the prd config
export DOPPLER_TOKEN="dp.st.prd.xxxxx"

# 2. Pull images and start, with secrets injected by Doppler
doppler run -- docker compose pull
doppler run -- docker compose up -d
```

`docker-compose.yml` defines three services:

- **backend** — the FastAPI API (`uvicorn api:app`)
- **slack-bot** — the same backend image run with `command: python3 bot.py`;
  starts only if `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN` are present
- **frontend** — the Next.js app

It pulls the prebuilt images, names the env vars each service needs (Doppler
supplies the values), and mounts the mutable data files (`users.json`,
`history.json`, `feedback_log.jsonl`) plus shared `hf_models` / `feedback_data`
volumes so the embedding model downloads once and corrections survive restarts.

> The Slack bot is optional. If you don't use Slack, simply omit the
> `slack-bot` service (or leave its tokens unset) — the API and the three
> web-based correction channels work without it.

### Production checklist

- [ ] `API_JWT_SECRET` identical in both services, different from `NEXTAUTH_SECRET`
- [ ] `ALLOWED_ORIGINS` set to the real frontend origin (no `*`)
- [ ] `AUTH_DISABLED` unset; `ENV=production`
- [ ] Both services behind a TLS reverse proxy (e.g. Caddy/Nginx); backend
      `:8000` not publicly exposed
- [ ] `users.json` / `history.json` / `feedback_log.jsonl` on a backed-up volume
- [ ] `NEXT_PUBLIC_API_URL` built with the production URL (rebuild the frontend
      image after changing it)

## Roles &amp; permissions

One role per user, strictly hierarchical. Enforced by the backend on **every**
request — the UI gating is convenience only.

| Capability | Admin | Reviewer | Solutions Engineer | Read-only |
|---|:--:|:--:|:--:|:--:|
| Ask the assistant | ✓ | ✓ | ✓ | ✓ |
| Generate / edit answers | ✓ | ✓ | ✓ | |
| Approve / reject (review queue) | ✓ | ✓ | | |
| Manage knowledge base | ✓ | ✓ | ✓ | |
| Export | ✓ | ✓ | ✓ | ✓* |
| Manage users | ✓ | | | |
| Settings | ✓ | | | |

Bootstrap admins come from `ADMIN_EMAILS`. Everyone else who signs in gets
`DEFAULT_ROLE` (read-only) until an admin assigns a role on the Users page.

## Switching the LLM provider

No code change — set three env vars and restart the backend:

```bash
# Groq (default)
LLM_PROVIDER=groq
LLM_MODEL=meta-llama/llama-4-scout-17b-16e-instruct
LLM_API_KEY=gsk_...

# Claude
LLM_PROVIDER=anthropic
LLM_MODEL=claude-sonnet-4-5
LLM_API_KEY=sk-ant-...

# OpenAI
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o
LLM_API_KEY=sk-...
```

## Security

- Short-lived (15 min) HS256 JWTs; algorithm pinned, expiry required.
- Per-request RBAC on every endpoint; document-level ownership checks.
- File-upload validation (real content type + size cap), rate limiting on
  generation, input length limits, security headers (CSP/HSTS/X-Frame-Options).
- Secrets never committed; injected at runtime via Doppler.
- Dependency CVEs patched via pinned versions; `pip-audit` in the workflow is
  recommended.

See `SECURITY.md` for the full posture and the residual-risk register.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Every API call returns 401 | `API_JWT_SECRET` differs between services, or a stale token — sign out/in |
| Knowledge page shows 0 vectors | Backend can't reach Qdrant — check `QDRANT_URL` / `QDRANT_API_KEY` |
| 403 on most pages | Your email isn't in `ADMIN_EMAILS`, or the value has stray characters |
| `Sign in` blocked by Google | OAuth consent screen `User type` is Internal, or email not a test user |
| Frontend can't reach API | `NEXT_PUBLIC_API_URL` wrong (rebuild needed) or CORS `ALLOWED_ORIGINS` |
| Sync re-ingests everything | Qdrant payload index on `file_id` missing — created automatically on fresh collections |

---

© Matters AI. Internal project — not for public distribution.
