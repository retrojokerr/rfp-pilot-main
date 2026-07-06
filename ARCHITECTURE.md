# RFP Pilot — Architecture & Operations

Detailed documentation for **Matters AI · RFP Pilot**. For the one-page overview
and quick-start, see **[README.md](./README.md)**.

**Contents**
- [System overview](#system-overview)
- [Request flows](#request-flows)
- [The RAG pipeline](#the-rag-pipeline)
- [Review workflow](#review-workflow)
- [Data model](#data-model)
- [API reference](#api-reference)
- [Access control](#access-control)
- [Configuration reference](#configuration-reference)
- [Deployment](#deployment)
- [Caveats & known issues](#caveats--known-issues)

---

## System overview

RFP Pilot is a two-service application (Next.js frontend + FastAPI backend) backed
by PostgreSQL (Neon) and a Qdrant Cloud vector store, using Groq for LLM
generation. A Slack bot runs from the same backend image for conversational Q&A.

In production everything sits behind a single Caddy reverse proxy on one AWS EC2
host, with TLS terminated by Caddy and secrets injected at runtime by Doppler.

```
                          ┌────────────────────────────────────────┐
   Browser ── HTTPS ──►   │  Caddy (TLS, reverse proxy)             │
                          │   /api/auth/*  → frontend (NextAuth)    │
                          │   /api/token   → frontend               │
                          │   /api/*       → backend (prefix strip) │
                          │   /*           → frontend               │
                          └───────────┬───────────────┬────────────┘
                                      │               │
                          ┌───────────▼──┐   ┌────────▼─────────────┐
                          │  Frontend    │   │  Backend (FastAPI)   │
                          │  Next.js 15  │   │  RAG + review + auth │
                          │  NextAuth v5 │   │  SQLModel + Alembic  │
                          └──────────────┘   └───┬──────┬──────┬────┘
                                                 │      │      │
                                    ┌────────────▼─┐ ┌──▼───┐ ┌▼─────────┐
                                    │ Postgres     │ │Qdrant│ │ Groq LLM │
                                    │ (Neon)       │ │Cloud │ │          │
                                    └──────────────┘ └──────┘ └──────────┘
   Slack ── Socket Mode ──► Slack bot (same backend image) ──► Qdrant + Groq
```

**Why the split matters:** the frontend owns the browser session (NextAuth +
Google OAuth) and mints a short JWT signed with a shared secret. The backend
verifies that JWT on every request and independently resolves the caller's role
and capabilities. The backend is the authoritative security boundary — the
frontend's gating is purely for UX.

---

## Request flows

### Authentication

1. User clicks "Sign in with Google" → NextAuth runs the Google OAuth flow.
2. NextAuth's `signIn` callback (frontend `src/auth.ts`) enforces two gates:
   - **Domain policy** — the email must end in the company domain
     (`@matters.ai`), *unless* running locally with `ALLOW_ANY_GOOGLE=true` and
     `NODE_ENV=development`.
   - **Closed allowlist** — it calls the backend `GET /access-check?email=` and
     only proceeds if `{allowed: true}`. This **fails closed**: any error or
     non-OK response denies the sign-in.
3. On success NextAuth creates a session and (via a token endpoint) issues a JWT
   signed with `API_JWT_SECRET`.
4. Every API call carries that JWT. The backend `current_user` dependency decodes
   it (HS256, requiring `exp`/`sub`/`iat`), resolves the role, and rejects the
   request with **403** if the email isn't allowlisted — even a validly-signed
   token for a non-allowlisted email is refused.

### Answering a questionnaire

1. **Upload** the workbook. The raw bytes are validated (magic-byte + zip
   integrity for xlsx, UTF-8 sanity for csv) and stored in Postgres
   (`original_documents`) keyed by a client-supplied `doc_id`.
2. **Parse** extracts questions (with section/subsection context and their
   source row/column positions).
3. **Generate** — for each question, `ask()` runs the RAG pipeline and returns
   `{answer, sources, confidence}`. The answer text encodes `AVAILABILITY:` and
   `REMARKS:` lines.
4. The user reviews drafts in the Workspace, then **submits a sheet for review**.

### Review → export

1. A submission (`review_submissions` + per-answer `review_items`) is created;
   reviewers are notified.
2. A reviewer opens the submission, edits/accepts/flags/rejects items, and either
   **approves** or **sends back**.
3. On approval, each corrected answer becomes a `FeedbackPair` and is ingested
   into Qdrant as a tier-1 "golden answer."
4. **Export** reads the stored original workbook and writes each approved answer
   back into its exact `(sheet, source_row, source_col)` position, preserving the
   original structure — then streams the file back for download.

---

## The RAG pipeline

Implemented in `retriever.py` (`ask()` → `retrieve()` + `generate_answer()`),
`ingest.py` (Qdrant + embeddings), and `confidence.py`.

**Embeddings.** Queries and documents are embedded locally with
`BAAI/bge-small-en-v1.5` (384-dim, normalized) via sentence-transformers on CPU.
The same model is used for ingestion and query time, so the vectors are
comparable.

**Tiered retrieval.** `retrieve()` queries Qdrant in two tiers:

- **Tier 1 — golden answers.** Human-verified corrections (from review approvals
  and Slack feedback) are stored with `source_type = "golden_answer"`. They're
  queried first, filtered to that type. If the top golden match scores above a
  short-circuit threshold, it *is* the answer — documents are skipped entirely. A
  relevant human correction can never be outranked by a raw document chunk.
- **Tier 2 — knowledge-base documents.** Regular document chunks are retrieved and
  ranked by a blend of semantic similarity (0.7) and recency (0.3).

**Resilience.** Both Qdrant queries run through a retry helper (3 attempts, short
backoff) to absorb transient connection resets. If the Tier-2 query still fails,
retrieval degrades gracefully — it returns whatever golden chunks it has (possibly
none) rather than 500-ing the whole `/answer` request. The Qdrant client is
configured with a 30s timeout.

**Generation.** The retrieved context is passed to the Groq LLM
(`LLM_MODEL`, default `meta-llama/llama-4-scout-17b-16e-instruct`) to produce the
`AVAILABILITY` + `REMARKS` answer.

**Confidence.** `compute_confidence()` scores each answer; golden-answer matches
score highest (human-verified = 1.0).

---

## Review workflow

The review workflow (`review_workflow.py`) is document-centric: one submission per
sheet, containing one review item per answer.

**States.** A `ReviewSubmission` moves through `pending → approved | sent_back`.
Each `ReviewItem` carries a `flag_type` (`untouched | accepted | corrected |
flagged | rejected`) and, after review, a `decision`.

**Reviewer actions.** A reviewer can edit an answer inline (edit-then-approve),
accept it as-is, flag it, or reject it, then approve or send back the whole
submission with an optional comment.

**Resubmission lineage.** When a sent-back submission is corrected and resubmitted,
the new submission points back via `previous_submission_id` and increments
`cycle`. This forms a chain so "My Submissions" can group a sheet's whole review
history.

**Scoping.**
- **My Submissions** shows only the caller's own submissions (filtered to the
  signed-in email regardless of role).
- **Review Queue** is a single shared queue — all reviewers/admins see all pending
  submissions. There is no per-reviewer assignment or claiming; concurrent reviews
  are last-write-wins (acceptable at pilot scale).

**Notifications.** New submissions notify all reviewers/admins (the fan-out unions
registered reviewer/admin rows with `ADMIN_EMAILS` bootstrap admins, minus the
submitter). Approvals/send-backs notify the specific submitter.

**Faithful export.** Because each `ReviewItem` captured its `(sheet_name,
source_row, source_col)` at parse time, and the original workbook is stored in
`original_documents`, export writes answers back into the exact original layout.
Legacy submissions created before this ("Phase 5") have null positional metadata
and aren't export-eligible.

---

## Data model

Seven SQLModel tables (`models.py`), managed by Alembic migrations.

### `users`
The role registry. Primary key is the email.

| Column | Type | Notes |
|---|---|---|
| email | str (PK) | lowercased on lookup |
| name | str? | |
| role | str | `admin` \| `reviewer` \| `solutions_engineer` \| `readonly` |
| created_at / updated_at | datetime | |

> Note: `ADMIN_EMAILS` bootstrap admins do **not** need a row here — they resolve
> to `admin` at request time. The table is often empty in practice.

### `history`
Per-generation history entries.

| Column | Type | Notes |
|---|---|---|
| id | str (PK, uuid) | |
| owner | str | email |
| filename | str | |
| row_count | int | |
| generated_at | datetime | |
| payload | JSON | full entry payload |

### `feedback_pairs`
Question/answer feedback — the source of golden answers.

| Column | Type | Notes |
|---|---|---|
| id | str (PK, uuid) | |
| question / good_answer | Text | |
| bad_answer | Text? | the original answer when corrected |
| section / availability / confidence | | |
| signal | str? | `approved` \| `rejected` \| `thumbs_up` \| `thumbs_down` \| `correction` |
| source | str? | `slack` \| `workspace` \| `assistant` \| `review_queue` |
| user_name / user_email | str? | who gave the feedback |
| reviewer_email / reviewer_name | str? | stamped when the correction came via a Review Queue approval; null otherwise |
| created_at | datetime | |

### `review_submissions`
One per submitted sheet.

| Column | Type | Notes |
|---|---|---|
| id | str (PK, uuid) | |
| doc_id | str | workspace document id |
| sheet_name | str | |
| submitted_by | str | email |
| status | str | `pending` \| `approved` \| `sent_back` |
| reviewed_by / reviewed_at / reviewer_comment | | |
| previous_submission_id | str? (indexed) | resubmission lineage |
| cycle | int | increments on resubmit |
| question_col_name / availability_col_name / remarks_col_name | str? | Phase-5 export pointers; null = not exportable |
| display_name | str? | human label; UI falls back to sheet_name |

### `review_items`
One per answer within a submission.

| Column | Type | Notes |
|---|---|---|
| id | str (PK, uuid) | |
| submission_id | str (FK → review_submissions.id, indexed) | |
| question_id / question / section | | |
| answer | Text | current answer |
| original_answer | Text | AI first draft |
| corrected_answer | Text? | reviewer's correction |
| flag_type | str | `untouched` \| `accepted` \| `corrected` \| `flagged` \| `rejected` |
| decision | str? | `approved` \| `rejected` |
| comment / confidence / availability | | |
| sheet_name / source_row / source_col | str?/int?/int? | positional metadata for faithful export; null on legacy items |

### `notifications`
In-app notifications.

| Column | Type | Notes |
|---|---|---|
| id | str (PK, uuid) | |
| user_email | str (indexed) | |
| type | str | `submission_received` \| `submission_approved` \| `submission_sent_back` |
| message / link | | |
| read | bool | |
| created_at | datetime | |

### `original_documents`
Raw uploaded workbook bytes for faithful export.

| Column | Type | Notes |
|---|---|---|
| doc_id | str (PK) | |
| filename / content_type | str | `xlsx` \| `xls` \| `csv` |
| content | LargeBinary (bytea) | the raw file |
| uploaded_by / uploaded_at | | |

> Stored in Postgres for now (pilot files are 1–5 MB). Swap for S3 later behind
> the same `doc_id` key if files grow.

---

## API reference

All endpoints require a valid JWT except `/health` and `/access-check`. The
`require(...)` capability needed is noted where applicable (see
[Access control](#access-control) for the role→capability map). In production all
paths are reached under `/api/*` (Caddy strips the prefix before forwarding to the
backend); NextAuth's own routes live under `/api/auth/*` and go to the frontend.

### Core (`api.py`)

| Method & path | Capability | Purpose |
|---|---|---|
| `GET /health` | — | Liveness probe |
| `GET /access-check?email=` | — (unauth) | Allowlist check used by frontend signIn |
| `GET /me` | (auth) | Current user + capabilities |
| `GET /system/model-info` | (auth) | Running LLM model (key masked) |
| `GET /history` | kb_read | List generation history |
| `PUT /history` | (auth) | Upsert a history entry |
| `DELETE /history/{entry_id}` | (auth) | Delete a history entry |
| `GET /review-queue` | kb_read | (legacy workspace review-queue state) |
| `PUT /review-queue` | (auth) | Update review-queue state |
| `GET /stats` | kb_read | Aggregate stats |
| `POST /answer` | ask | Answer one question (rate-limited 20/min) |
| `POST /documents/upload` | generate | Store raw workbook bytes (for export) |
| `POST /parse` | generate | Parse a document into questions |
| `POST /upload` | kb_write | Upload + parse + auto-answer |
| `POST /generate/{doc_id}` | generate | Generate remaining answers for a doc |
| `GET /documents` | kb_read | List uploaded documents |
| `GET /responses/{doc_id}` | kb_read | Get generated responses |
| `POST /regenerate` | generate | Regenerate a single answer |
| `GET /knowledge` | kb_read | Knowledge-base stats |
| `POST /knowledge/sync` | kb_write | Sync/ingest knowledge base |
| `GET /knowledge/sync` | kb_read | Sync status |
| `POST /export` | export | Export responses (xlsx/docx/pdf) |
| `POST /feedback/ingest` | (auth) | Ingest a correction as a golden answer |
| `GET /feedback` | feedback_read | List feedback pairs |
| `GET /admin/users` | manage_users | List registry users + roles |
| `PUT /admin/users` | manage_users | Add/update a user's role |
| `DELETE /admin/users/{email}` | manage_users | Remove a user (bootstrap admins protected) |

### Review workflow (`review_workflow.py`)

| Method & path | Purpose |
|---|---|
| `POST /submissions` | Create a submission (submit a sheet for review) |
| `GET /submissions` | List submissions (scoped: own for non-reviewers, all for reviewers) |
| `GET /submissions/{id}` | Get one submission + its items |
| `POST /submissions/{id}/approve` | Approve (with per-item edits); writes golden answers |
| `POST /submissions/{id}/send-back` | Send back with a comment |
| `GET /submissions/{id}/export` | Faithful export of the approved sheet |
| `GET /notifications` | List the caller's notifications |
| `POST /notifications/{id}/read` | Mark one read |
| `POST /notifications/read-all` | Mark all read |
| `GET /dashboard-stats` | Dashboard metrics |

---

## Access control

**Two independent gates**, both enforced:

1. **Domain policy** (frontend signIn) — email must be `@matters.ai` in
   production. Locally, `ALLOW_ANY_GOOGLE=true` + `NODE_ENV=development` bypasses
   this for multi-user testing.
2. **Closed allowlist** (backend, authoritative) — an email is allowed only if it
   has a `users` row **or** is in `ADMIN_EMAILS`. There is no default-role
   fallback: unknown emails are denied (**403**). The frontend calls
   `/access-check` during signIn so denied users get a clean "not authorised"
   page instead of a broken session.

**Roles → capabilities** (`auth.py`; strictly hierarchical, one role per user):

| Capability | admin | reviewer | solutions_engineer | readonly |
|---|:--:|:--:|:--:|:--:|
| ask | ✓ | ✓ | ✓ | ✓ |
| generate | ✓ | ✓ | ✓ | |
| correct | ✓ | ✓ | ✓ | |
| kb_read / kb_write | ✓ | ✓ | ✓ | |
| export | ✓ | ✓ | ✓ | |
| feedback_read | ✓ | ✓ | ✓ | |
| approve | ✓ | ✓ | | |
| manage_users | ✓ | | | |
| manage_settings | ✓ | | | |

- **admin** — everything, including user management & settings.
- **reviewer** — everything except settings; can review/approve.
- **solutions_engineer** — everything except review/approve and settings.
- **readonly** — Assistant only (can ask questions, nothing else).

**Bootstrap safety.** `ADMIN_EMAILS` admins are un-lockable: they can't be deleted
via the Users page, and they retain admin even with no registry row. This prevents
locking yourself out.

**`AUTH_DISABLED=true`** short-circuits `current_user` to a synthetic admin — a
local-only escape hatch. A startup warning fires if it's set, and escalates if the
environment isn't development. **Never set this in production.**

---

## Configuration reference

Secrets are managed in **Doppler** for production and in `.env` / `.env.local`
files for local development. Every variable the code actually reads:

### Backend (`os.getenv`)

| Variable | Required | Purpose |
|---|:--:|---|
| `DATABASE_URL` | ✓ | Postgres (Neon) connection string. Must include a valid `sslmode` (e.g. `require`). |
| `QDRANT_URL` | ✓ | Qdrant Cloud endpoint |
| `QDRANT_API_KEY` | ✓ | Qdrant Cloud API key |
| `GROQ_API_KEY` | ✓ | Groq API key |
| `LLM_PROVIDER` | | LLM provider (e.g. `groq`) |
| `LLM_MODEL` | | Model id (default `meta-llama/llama-4-scout-17b-16e-instruct`) |
| `LLM_API_KEY` | | LLM key (often same as `GROQ_API_KEY`) |
| `LLM_TEMPERATURE` / `LLM_MAX_TOKENS` | | Generation params |
| `API_JWT_SECRET` | ✓ | HS256 secret; **must match** the frontend's value |
| `ADMIN_EMAILS` | ✓ | Comma-separated bootstrap admin emails |
| `ALLOWED_ORIGINS` | ✓ | CORS allowlist (defaults locked down; `*` for local only) |
| `DRIVE_FOLDER_ID` / `GOOGLE_CREDENTIALS_PATH` | | Google Drive integration |
| `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN` | (bot) | Slack bot credentials |
| `API_URL` | (bot) | Backend URL the bot calls for ingest (default `http://backend:8000`) |
| `AUTH_DISABLED` | | Local-only auth bypass. Never `true` in prod. |
| `ENV` | | Environment label used by the startup warning |
| `FEEDBACK_LOG` / `USERS_FILE` / `HISTORY_FILE` / `REVIEW_FILE` | | Legacy file paths (vestigial post-Postgres) |

### Frontend (`process.env`)

| Variable | Build/Run | Purpose |
|---|:--:|---|
| `NEXT_PUBLIC_API_URL` | **both** | Backend base URL. Baked into the browser bundle at build time **and** read at runtime by the signIn `/access-check` fetch. In prod it is `https://<host>/api` (the `/api` is correct — Caddy strips it). |
| `NEXTAUTH_SECRET` | run | NextAuth session secret |
| `NEXTAUTH_URL` | run | Public site URL |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | run | Google OAuth client |
| `API_JWT_SECRET` | run | Must match the backend's value |
| `ALLOW_ANY_GOOGLE` | run | Local-only domain-gate bypass (with `NODE_ENV=development`) |
| `NODE_ENV` | run | `development` locally; automatically `production` in the built image |
| `NEXT_PUBLIC_AUTH_DISABLED` | build | Local-only auth-disable flag |

> **`NEXT_PUBLIC_*` are compiled into the browser bundle at build time.** In CI,
> `NEXT_PUBLIC_API_URL` is passed as a Docker `build-arg` from a **GitHub Actions
> secret** — not from Doppler. It must *also* be present in the frontend
> container's runtime env (from Doppler/compose) because the server-side signIn
> callback reads it at runtime.

---

## Deployment

**Model:** build-in-CI, pull-on-server. Everything runs on one EC2 host behind
Caddy, with Doppler injecting secrets at container-run time.

### Pipeline

`.github/workflows/docker-build.yml` triggers on **push to `main`** (or manual
dispatch). It builds two images and pushes them to GHCR:

- `ghcr.io/retrojokerr/rfp-pilot-backend:latest` (+ `:${sha}`)
- `ghcr.io/retrojokerr/rfp-pilot-frontend:latest` (+ `:${sha}`)

The frontend build bakes `NEXT_PUBLIC_API_URL` from a GitHub Actions secret.
**CI only builds and pushes — it does not deploy.**

### Host layout (EC2)

- Deploy dir: `/home/ubuntu/rfp-deploy/` (holds `docker-compose.yml` + `Caddyfile`)
- Containers: `caddy`, `backend`, `slack-bot` (same image as backend), `frontend`
- Secrets: injected via `doppler run --` at compose time (a prd service token is
  exported in the shell; compose's bare env-var names pick them up)

**Caddyfile routing** (order matters):

```
rfp.<host>.sslip.io {
    handle /api/auth/* { reverse_proxy frontend:3000 }   # NextAuth
    handle /api/token   { reverse_proxy frontend:3000 }   # token minting
    handle_path /api/*  { reverse_proxy backend:8000 }    # strips /api → backend
    handle              { reverse_proxy frontend:3000 }   # everything else
}
```

### Standard deploy

```bash
# 1. Ship code (local)
git push origin main                 # → CI builds + pushes images to GHCR
# wait for the GitHub Actions run to go green (both images pushed)

# 2. On the EC2 host
cd /home/ubuntu/rfp-deploy
export DOPPLER_TOKEN="<prd service token>"
doppler run -- docker compose pull
doppler run -- docker compose up -d
docker image prune -f                # reclaim dangling old images
docker compose ps                    # all healthy?

# 3. Smoke test
curl -s "https://rfp.<host>.sslip.io/api/access-check?email=<admin>@matters.ai"
#   → {"allowed":true}
curl -s "https://rfp.<host>.sslip.io/api/access-check?email=nobody@random.com"
#   → {"allowed":false}
# then in a browser: login → generate → submit → review → approve
```

### Gotchas (learned the hard way)

- **Disk vs. image size.** The backend image is large (~3.2 GB — it bundles
  PyTorch/CUDA for the local embedding model). On a small root volume (e.g. 19 GB)
  a normal `docker compose pull` can fill the disk mid-extract, because the old and
  new images coexist during the pull. Options:
  - **Grow the EBS volume** (recommended) to give headroom, then resize:
    `sudo growpart /dev/<dev> 1 && sudo resize2fs /dev/root`.
  - **Staged pull** — pull/recreate one service at a time and `docker image
    prune -f` between each. The backend and slack-bot share an image, so pulling
    the backend covers both; recreate the bot without a second pull.
  - **Free-old-first (brief downtime)** — `docker compose stop backend slack-bot`,
    `docker image rm -f …backend:latest`, `docker image prune -f`, then pull. A
    stopped container still references the image, so use `-f` (or `docker rm` the
    containers first).
  - Never run `docker system prune --volumes` — it would delete the model cache
    and data volumes.
- **`DATABASE_URL` must be in the compose env lists.** Compose's `environment:` is
  an explicit allowlist; a bare `- DATABASE_URL` passes the value through from
  `doppler run`, but only if the line is present under the **backend** service.
  (The slack-bot doesn't use Postgres — it only needs Qdrant/Groq/Slack — so it
  doesn't need it. A stray copy on the frontend service is inert.)
- **`sslmode` corruption.** A malformed `DATABASE_URL` (e.g. `sslmode=requireQ`
  from a copy-paste slip) crashes the backend on startup with
  `invalid sslmode value`. Verify the Doppler value reads `sslmode=require`.
- **The `/api/auth/*` collision.** Because Caddy routes `/api/auth/*` to the
  *frontend* (for NextAuth), the backend allowlist endpoint must **not** live under
  `/auth/*`. It's mounted at `/access-check` (reached as `/api/access-check`,
  which Caddy routes to the backend). Don't move it back under `/auth`.
- **`NODE_ENV` in prod.** The frontend image is a production build; `NODE_ENV` is
  automatically `production`. Do **not** set `NODE_ENV=development` on the prod
  container — it breaks a production build and would open the domain-gate bypass.
- **Migrations.** The Docker image does **not** run migrations on boot (its `CMD`
  is just `uvicorn …`; `create_db_and_tables()` only creates missing *tables*, not
  columns). When the schema changes, run `alembic upgrade head` against the target
  database before the new code serves traffic. (If prod shares the dev database and
  it's already at head, no action is needed — see caveats.)
- **Google OAuth redirect URI.** The prod callback
  `https://<host>/api/auth/callback/google` must be registered in the Google Cloud
  Console, or login fails with `redirect_uri_mismatch`.

### Automating the deploy (optional)

A `deploy.sh` on the host reduces the manual steps to one command:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd /home/ubuntu/rfp-deploy
doppler run -- docker compose pull
doppler run -- docker compose up -d
docker image prune -f
docker compose ps
```

For full CD, add an SSH-based deploy job to the GitHub Actions workflow (needs an
SSH key as a GH secret + the host). Recommended only once the manual flow is
trusted — for a DB-backed pilot, keep a human in the loop for the first deploys.

---

## Caveats & known issues

**Infrastructure / ops**
- **Shared dev/prod database (temporary).** Prod currently uses the same Neon
  database as local dev. Consequences: prod pilot data mixes with dev test data,
  and local development can affect prod data. Split into a dedicated prod database
  (and clean out test-data pollution) before real pilot traffic. Because the shared
  DB is already migrated to head, deploys need no migration step today.
- **Large backend image (~3.2 GB).** Driven by PyTorch (which bundles unused CUDA
  libraries on this GPU-less host) for the local BGE embedding model. Planned fix:
  drop PyTorch by switching embeddings to an ONNX runtime (e.g. `fastembed`) using
  the **same** `BAAI/bge-small-en-v1.5` model, so existing Qdrant vectors stay
  valid (no re-ingestion) and the image shrinks toward ~500 MB. Must verify
  embedding parity against the existing collection before shipping. (A quick
  interim win: install CPU-only PyTorch to drop ~2 GB.)
- **Single-process backend.** Uvicorn runs one worker; auto-refresh polling shares
  the event loop with generation. Fine for the pilot; size accordingly if load
  grows.
- **Rotate exposed secrets.** If a Doppler service token or any secret has ever
  been pasted into a chat/log, rotate it (Doppler → prd config → Access).

**Application**
- **In-memory workspace store.** Un-submitted workspace document state is held in
  memory in the backend and is lost on restart. Submissions (in Postgres) are
  durable; drafts are not.
- **Concurrent reviews are last-write-wins.** The review queue is shared with no
  assignment/claiming; two reviewers acting on the same submission can overwrite
  each other. Acceptable at pilot scale.
- **Multi-sheet upload submits one sheet.** The mapping step allows mapping
  multiple sheets, but only the first fully-mapped sheet is submitted (silently).
  Multi-sheet is a planned enhancement.
- **`corrected_answer` double duty.** The field serves as both "the correction"
  and "reviewer's suggestion," disambiguated by comparing to `answer`. A distinct
  `reviewer_suggested_answer` field would be cleaner.
- **Timezone-naive timestamps.** Stored UTC-naive; the frontend appends `Z`.
  Works; `TIMESTAMP WITH TIME ZONE` would be cleaner.
- **Legacy export-ineligibility.** Submissions/items created before positional
  metadata + stored originals existed have null positions and can't be
  faithfully exported.

**Slack bot**
- The bot's live-ingest of corrections depends on reaching the backend at
  `API_URL` (defaults to the compose service name `http://backend:8000`). For
  local runs outside Docker, set `API_URL=http://localhost:8000`. If the backend
  is unreachable, feedback still logs locally but isn't ingested into the KB.
