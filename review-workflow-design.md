# Document-Centric Review Workflow — Design

Status: **implemented** (Phases 1–5). Replaces the per-question review model
with a per-sheet (submission) review workflow on Postgres, plus in-app
notifications, a "My Submissions" view for submitters, and faithful export
that writes approved answers back into the original workbook.

> This doc reflects what is actually built. Sections marked _(pending)_ are
> designed but not yet implemented.

## Why

Previously the unit of review was a single answer (`responses[]`, each with its
own status, stored in browser localStorage). Real RFP review is
document-centric: a person works a whole sheet, then hands it to a reviewer as
one package. This redesign makes the **submission** (a snapshot of a sheet + its
answers) the unit of review, persisted server-side in Postgres.

## Roles

- **Submitter** — anyone with `generate` (solutions_engineer, reviewer, admin).
  Works the sheet, decides per-answer what happens, submits for review.
- **Reviewer** — `reviewer` + `admin`. Reviews submissions, approves (triggers
  KB ingestion) or sends back with feedback.

## Per-answer decision (Workspace, after generation)

For each generated answer the submitter picks one of three paths:

1. **Accept** (default) — the answer is good as-is; it ships in the sheet.
   No knowledge-base write. (Correct AI answers are NOT re-ingested — the KB
   only learns from human corrections.) If the submitter *edits* an accepted
   answer, that edit ingests immediately (the fast path / strongest signal).
2. **Correct & send for review** — the submitter's correction is staged but
   NOT ingested. KB ingestion is deferred until a reviewer approves.
3. **Flag for review (no correction)** — submitter is unsure; wants a second
   opinion. The answer is locked as-is (not editable in this path) and tagged
   "flagged". Editing instead means using path 2.

### Submission rule

- If **all** answers are Accept → no submission; the sheet just ships.
- If **any** answer is path 2 or 3 → the whole sheet becomes one
  **ReviewSubmission**.
- In a mixed sheet, accepted answers are included in the submission but tagged
  **"accepted"** — visible to the reviewer for context, non-actionable (dimmed).

## Reviewer experience (Review Queue → file view)

The Review Queue shows **submission-cards** (not question-cards):

> Sheet: `DSPM_RFP.xlsx` · submitted by {email} · 2h ago
> 5 questions · 1 corrected · 1 flagged  [Resubmission · cycle 2]

The queue shows only the **latest cycle** of each lineage (resubmissions don't
appear as duplicates). Resubmitted sheets carry a "Resubmission · cycle N" badge.
Submissions display a user-provided **display name** (captured at upload) when
set, falling back to the sheet name.

Opening a submission shows the **whole sheet**:
- **Touched** answers (corrected / flagged) are highlighted.
- **Accepted** answers are shown dimmed, non-actionable.
- On a resubmission, a one-line banner notes "you flagged N answers last cycle".

Per touched answer, the reviewer can:
- **Approve** as-is, or
- **Edit then approve** — the reviewer may improve an answer inline and approve;
  the edited text becomes the correction that ingests to the KB and writes to
  the export. Attributed to the submitter, stamped with the approving reviewer.
- **Reject** — the answer becomes inline-editable (pre-filled). The reviewer
  either edits it (a genuine change) OR leaves it and adds a comment. One of
  the two is required. Rejecting any answer sends the whole sheet back.

> Design note: an earlier version of this doc said "no reviewer
> inline-edit-then-approve — corrections flow through the submitter." That was
> reversed: forcing a reviewer to reject-and-send-back merely to record an
> improvement created a needless round-trip. Reviewers may now edit-and-approve;
> their edit is the source of truth for both the KB and the export.

### Sheet-level outcome — Model A (all-or-nothing)

- **Approve sheet** — all corrected/flagged-with-correction answers (plus any
  reviewer edits made at approval) ingest to the KB now, and are written into
  the exported workbook. Reviewer is stamped; submitter notified.
- **Send back** — if any answer is rejected, the **whole** sheet returns to the
  submitter with the feedback. **Nothing ingests.** The submitter addresses the
  rejected items and resubmits, creating a new cycle. Ingestion happens only on
  an eventual full approval. **No partial ingestion on send-back.**

## Submitter experience — "My Submissions"

A dedicated page (for users with `generate`):
- Submissions grouped by **sheet lineage** (following `previous_submission_id`).
  Each sheet is one card; resubmission cycles show as a thread (current cycle
  emphasized, older cycles dimmed).
- **Pending** → read-only "awaiting review".
- **Approved** → success banner + **Download answered sheet** (faithful export;
  see Phase 5).
- **Sent back (latest cycle)** → shows only the rejected items with the
  reviewer's comment/suggested answer; each answer is editable; **Resubmit**
  creates a new cycle (Option A: each cycle is its own record; prior cycles
  preserved as read-only history).
- **Superseded cycles** (already resubmitted) render read-only — no edit fields,
  no resubmit.

## Notifications (in-app, v1)

- **On submit** → each reviewer/admin (except the submitter) gets a
  `submission_received` notification.
- **On approve** → submitter gets `submission_approved`.
- **On send-back** → submitter gets `submission_sent_back`.
- Backend endpoints exist: `GET /review/notifications`,
  `POST /review/notifications/{id}/read`, `POST /review/notifications/read-all`.
- _Frontend bell/dropdown UI: pending (Phase 3)._ No email/Slack in v1.

## Data model (Postgres / SQLModel)

Tables (see `models.py`, migrated via Alembic):

```
ReviewSubmission {
  id, doc_id, sheet_name
  submitted_by, submitted_at
  status                      # pending | approved | sent_back
  reviewed_by, reviewed_at
  reviewer_comment
  previous_submission_id      # resubmission lineage (Option A)
  cycle                       # 1 = first; increments on resubmit
  # Phase 5 additions:
  question_col_name           # column-name pointers into the original workbook
  availability_col_name       #   (survive column reordering; used at export
  remarks_col_name            #   to write answers into the right columns)
  display_name                # user-provided RFP label, captured at upload
}

ReviewItem {
  id, submission_id (FK)
  question_id, question, section
  answer                      # current answer text (submitter-edited if changed)
  original_answer             # AI's first draft (used as export/feedback bad_answer)
  corrected_answer            # correction, if any (submitter or reviewer)
  flag_type                   # accepted | corrected | flagged | untouched
  decision                    # null | approved | rejected
  comment                     # reviewer feedback on reject
  confidence, availability
}

OriginalDocument {            # Phase 5: raw uploaded file, for faithful export
  doc_id (PK), filename, content (bytea), uploaded_by, uploaded_at
}

FeedbackPair {                # org-wide correction ledger (Feedback Loop page)
  id, question, bad_answer, good_answer, section, availability
  confidence, signal, source  # source: slack | workspace | assistant | review_queue
  user_name, user_email       # who gave the feedback (the submitter)
  reviewer_email, reviewer_name  # Phase 5: approving reviewer, when source=review_queue
  created_at
}

Notification { id, user_email, type, message, link, read, created_at }
```

Also migrated to Postgres: `users`, `history`, `feedback_pairs` (previously
JSON files). The old per-answer `review_queue.json` was NOT migrated — it
doesn't map to the submission model, and its corrections already live in Qdrant.

## KB ingestion rules (the critical invariant)

- **Accept**: no ingestion (correct AI answers are never re-ingested). An edit
  to an accepted answer ingests immediately (fast path).
- **Correct & review**: ingests ONLY when the reviewer approves the sheet.
- **Flag (no correction)**: no ingestion unless a reviewer supplies a correction
  and approves.
- **Rejected / sent-back**: never ingested. Ingestion for a bounced sheet waits
  until it is eventually fully approved.

The KB only ever learns human-blessed corrections — never the model's own
un-edited output. On approval, each ingested correction also writes a
`FeedbackPair` (source `review_queue`) so it appears in the Feedback Loop page,
attributed to the submitter and stamped with the approving reviewer. The
FeedbackPair's `bad_answer` is the AI's `original_answer`, so the Feedback Loop
shows a true before/after even when the submitter corrected inline before
submitting.

## Faithful export (Phase 5)

The exported file reproduces the questionnaire **as uploaded** — sheet names,
row order, original layout, formatting — with approved answers written into the
mapped response columns of the original rows. Only the answer columns are
touched; everything else is preserved byte-for-byte.

How it works:
1. The raw uploaded file is persisted at upload time (`OriginalDocument.content`
   as bytea in Postgres, keyed by `doc_id`) rather than discarded after parsing.
2. At export, the original is reopened with openpyxl.
3. Rows are matched by **normalized question text** (lowercase, collapsed
   whitespace, truncated) rather than by row index — this survives row shifts
   between what was submitted and what's in the file. Column targets come from
   the submission's `question_col_name` / `availability_col_name` /
   `remarks_col_name`.
4. Approved answers are written into the matched rows; all other cells, sheets,
   formulas, and formatting are untouched.

Robustness:
- **Merged cells** (section-header banners spanning the answer columns) are
  detected and skipped rather than written to (writing raises on read-only
  MergedCells). The parser also skips merged banner rows during extraction so
  section titles are never treated as answerable questions.
- Response headers expose `X-Items-Total`, `X-Items-Written`, and
  `X-Items-Skipped` / `X-Rows-Skipped-Merged` for debuggability.
- **Legacy submissions** created before Phase 5 (missing column-name pointers)
  return HTTP 409 with a clear message rather than producing a broken file.
- The download filename uses the sanitized `display_name` when set.

Download buttons live on approved cards in **My Submissions** (submitter) and
the approved view in **Review Queue** (reviewer); both use an auth-aware
fetch → blob → download.

## Operations dashboard

Backend-computed metrics (`GET /review/dashboard-stats`) rather than per-browser
wizard state, so numbers are team-wide and honest:
- **rfps_processed** — count of `OriginalDocument` upload events.
- **in_review / completed** — from the submission lineage.
- **days_saved** — `completed × (MANUAL_HOURS − GENERATION_HOURS)`; constants
  (16h manual, 0.25h generation) are returned so the UI can show the assumption.
- **median_review_minutes** — median of (final-approve − first-submit) across
  each approved lineage; median (not mean) to shrug off wall-clock outliers
  (sheets left sitting over days).
- **avg_confidence**.

Item-level dashboard counters count by each item's own `flag_type` / `decision`
(accepted / corrections / approved / rejected / awaiting), NOT by parent
submission status — the latter conflated "item in a sent-back sheet" with "item
was rejected."

## Phasing

- **Phase 1** ✅ — ReviewSubmission model + endpoints; Workspace "Send for
  Review" snapshot; Review Queue file-view; approve/send-back with KB ingestion.
- **Phase 2** ✅ — per-answer three-way decision UI in the Workspace.
- **Phase 3** 🔶 — notifications: backend done; bell/dropdown UI pending.
- **Phase 4** ✅ — "My Submissions" page (cycle lineage, resubmit, read-only
  history).
- **Phase 5** ✅ — **Faithful export** (persist original, write-back by
  normalized question match, merged-cell handling, download buttons,
  display-name capture, FeedbackPair-at-approval, honest dashboard).
- **Phase 6** ⬜ — **Multi-sheet handling** (below).

## Known limitations (current)

### Multi-sheet submission — NOT supported (silent single-sheet fallback)

A workbook can have multiple sheets, and the Map-columns step lets the user
map column roles on more than one sheet. However, the submit flow only
processes **one** sheet: the first sheet (in workbook order) that has all
three roles mapped (Question + →Yes/No/Partial + →Remarks).

**Behaviour today:** if a user maps two or more sheets and clicks
"Select questions" → the wizard silently proceeds with only the first
fully-mapped sheet. Items from the other mapped sheets are dropped without
warning. There is no error and no UI indication that data was left behind.

**Why:** `ReviewSubmission` is modelled as one submission = one sheet
(single `sheet_name` column). The mapping gate and `handleContinue` in
`MappingStep.tsx` resolve to a single `mappedSheet` via `sheets.find(...)`.

**Pilot guidance:** work one sheet per RFP submission. To submit a second
sheet of the same workbook, run it through the wizard as a separate pass.

## Phase 6 — Multi-sheet handling (pending, NOT started)

Real RFPs are multi-sheet. This phase makes the wizard handle a whole
workbook rather than silently collapsing to one sheet.

### Design decision (open): two possible models

**Option 1 — One submission per sheet (N submissions per workbook).**
- One upload → generate across all mapped sheets → produces N separate
  ReviewSubmissions, all sharing the same `doc_id`.
- Reviewer sees N cards in the queue (one per sheet).
- Export: either N per-sheet downloads, or a single "Export full workbook"
  that stitches every approved sheet's answers into one file (the existing
  placeholder button anticipates this).
- Pro: no schema change — fits the current one-sheet-per-submission model.
  Matches how RFP sheets are often split across different reviewers.
- Con: one RFP fragments into N queue items; needs workbook-level export to
  reassemble.

**Option 2 — One submission spanning multiple sheets.**
- One submission holds items from all sheets; each `ReviewItem` tagged with
  its source sheet.
- Reviewer sees one card, reviews the whole workbook (grouped by sheet).
- Pro: one RFP = one review unit, conceptually clean.
- Con: schema change (`ReviewItem.sheet_name`, submission drops its single
  `sheet_name`), export + review UI both change. Bigger build.

**Leaning:** Option 1 for the pilot (less work, no migration, matches
reviewer-splitting reality). Revisit if RFPs are typically reviewed whole by
one person, which favours Option 2.

### Open scoping questions (decide at phase start)

1. On "Send for review" with multiple mapped sheets — submit **all** mapped
   sheets at once, or let the user **pick** which sheet(s) to send?
2. "Export full workbook" — wait until **all** sheets' submissions are
   approved, or export whatever is approved so far (blanks for the rest)?

### Prerequisite / cleanup

- Fix the current silent-drop: at minimum warn the user which sheet will be
  submitted (and which are being dropped) before it happens. Ideally this goes
  away entirely once Phase 6 lands.

## Open questions / risks

- **In-memory DOCUMENTS**: submissions snapshot the sheet, so they survive a
  DOCUMENTS reset. But the Workspace still loses un-submitted state on restart
  (pre-existing; candidate for future persistence).
- **Concurrent reviews**: two reviewers on one submission → last-write-wins
  (acceptable at current scale).
- **Timezone**: timestamps stored UTC; frontend appends `Z` when a tz marker is
  absent so relative times parse correctly. A cleaner fix is tz-aware columns
  (`TIMESTAMP WITH TIME ZONE`) — minor follow-up.
- **Two-user testing**: ✅ verified locally with two real Google accounts
  (matters.ai admin/reviewer + external submitter). Access guards, notification
  routing, and reviewer-sees-all vs submitter-sees-own scoping all hold.
- **Reviewer "suggested answer" ambiguity**: `corrected_answer` is only shown to
  the submitter as a reviewer suggestion when it differs from the answer (guards
  against carried-over text reading as a suggestion). A cleaner model would use a
  distinct `reviewer_suggested_answer` field.
- **Test-data hygiene**: dashboard metrics currently compute over test noise
  (smoke-test file, repeated dev uploads, instant self-approvals, one multi-day
  test cycle). Clear test rows before the numbers are shown to anyone.