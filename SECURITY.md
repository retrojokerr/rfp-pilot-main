# Security Posture — Matters AI RFP Pilot

Last VAPT pass: full FE + BE sweep across OWASP Top 10 categories.
Status: **deployment-ready with the hardening below applied.**

## Fixed in this pass

### Critical
- **C1 — File upload validation.** `/parse` and `/upload` now verify real
  file bytes with `python-magic` (not just the attacker-controlled
  extension), enforce a 20 MB cap, and allow only xlsx/xls/csv.
- **C2 — Error message leakage.** Internal exceptions are logged server-side
  with a random reference ID; clients receive only `{message, ref}`. No
  stack traces, paths, or library internals reach the browser.

### High
- **H1 — Rate limiting.** `slowapi` caps `/answer` at 20/min per IP,
  protecting the LLM budget from abuse. Add limits to other endpoints as
  traffic patterns emerge.
- **H2 — Input limits on `/feedback/ingest`.** question ≤2000, good_answer
  ≤5000, section ≤200 chars; source is allowlisted; newlines stripped to
  prevent JSONL log injection.
- **H3 — IDOR on documents.** Every document records `owner_email`;
  `/responses`, `/generate`, `/regenerate`, `/export` enforce owner-or-admin
  access via `_require_doc_access`. Users can no longer read each other's
  parsed RFIs by guessing the 8-char doc_id.
- **H4 — Security headers.** `next.config.js` sets CSP, X-Frame-Options:DENY,
  X-Content-Type-Options:nosniff, HSTS, Referrer-Policy, Permissions-Policy
  on every response.
- **H5 — API token exposure.** Token is held in JS memory only (never
  localStorage), 15-min TTL, and the strict CSP blocks script injection and
  cross-origin exfiltration. See "Residual risks" for the hardened option.

### Medium / Low
- **M1** — users.json / history.json written with `chmod 600`.
- **M2** — `/feedback/debug` endpoint removed.
- **M3** — Role-based route blocking moved into Next.js middleware
  (server-side); direct URL navigation to forbidden pages is now blocked,
  not just hidden in the nav.
- **M5** — `API_JWT_SECRET` and `NEXTAUTH_SECRET` documented as DISTINCT
  secrets; reuse explicitly warned against.
- **L1** — Backend logs a loud warning if `AUTH_DISABLED=true`, and an
  explicit "stop this service" alert if `ENV` is not development.
- **L2** — Middleware public-route matching tightened (exact match for
  `/login`, scoped prefix for `/api/auth/`) to prevent `/api/auth-x` bypass.
- **JWT hardening** — algorithm pinned to HS256 (blocks alg-confusion /
  `none` attacks); `exp`, `sub`, `iat` claims required (rejects
  non-expiring tokens).

### Dependencies (CVE remediation)
`pip-audit` found 24 known CVEs across 7 packages; all fixable ones pinned:
PyJWT 2.10.1→2.13.0, starlette 1.0.0→1.0.1, urllib3 2.6.3→2.7.0,
idna 3.11→3.15, lxml 6.0.2→6.1.0, pypdf 6.9.2→6.12.0.

## Residual risks (accepted / roadmap)
- **torch CVE-2025-3000** — no patched version published yet. torch is a
  transitive dependency of the embedding model, not network-exposed. Monitor
  for a fix; re-pin when available.
- **H5 hardened option** — for maximum XSS resilience, replace the
  JS-memory token with a same-origin Next.js proxy that injects an HttpOnly
  cookie server-side, so the token is never reachable by JavaScript. Larger
  refactor; the current CSP + short TTL is the interim mitigation.
- **M4 — localStorage PII.** Review-queue state (questions, answers,
  reviewer emails) persists in plaintext localStorage. Resolved by the
  planned server-side review-state migration (Option 2). Until then, treat
  reviewer workstations as trusted.
- **In-memory DOCUMENTS dict** — resets on backend restart and isn't shared
  across replicas. Move to Postgres for production multi-instance.

## Pre-deployment checklist
- [ ] `API_JWT_SECRET` set identically in BOTH services; DIFFERENT from `NEXTAUTH_SECRET`
- [ ] `ALLOWED_ORIGINS` restricted to the real frontend origin (no `*`)
- [ ] `AUTH_DISABLED` unset; `ENV=production`
- [ ] Both ports behind a TLS reverse proxy; backend `:8000` not publicly exposed
- [ ] `users.json`, `history.json`, `feedback_log.jsonl` on a backed-up volume, not in git
- [ ] `pip install -r requirements.txt` (gets the CVE-patched pins)
- [ ] Run `pip-audit` in CI to catch new CVEs
