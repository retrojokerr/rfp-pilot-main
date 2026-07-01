# Document-Centric Review Workflow — Design

Status: **implemented** (Phases 1–4). Replaces the per-question review model
with a per-sheet (submission) review workflow on Postgres, plus in-app
notifications and a "My Submissions" view for submitters.

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

Opening a submission shows the **whole sheet**:
- **Touched** answers (corrected / flagged) are highlighted.
- **Accepted** answers are shown dimmed, non-actionable.
- On a resubmission, a one-line banner notes "you flagged N answers last cycle".

Per touched answer, the reviewer can:
- **Approve** as-is, or
- **Reject** — the answer becomes inline-editable (pre-filled). The reviewer
  either edits it (a genuine change) OR leaves it and adds a comment. One of
  the two is required. Rejecting any answer sends the whole sheet back.

**No reviewer inline-edit-then-approve.** The reviewer approves the sheet or
rejects answers (with correction/comment) that send it back. (Decided: reviewers
don't silently edit-and-approve; corrections flow through the submitter.)

### Sheet-level outcome — Model A (all-or-nothing)

- **Approve sheet** — all corrected/flagged-with-correction answers ingest to
  the KB now. Reviewer is stamped; submitter notified. _(Export: pending — see
  Phase 5.)_
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
- **Approved** → success banner. _(Export: pending — see Phase 5.)_
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
- _Frontend bell/dropdown UI: pending._ No email/Slack in v1.

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
}

ReviewItem {
  id, submission_id (FK)
  question_id, question, section
  answer                      # current answer text
  original_answer             # AI's first draft
  corrected_answer            # correction, if any (only set when it differs)
  flag_type                   # accepted | corrected | flagged | untouched
  decision                    # null | approved | rejected
  comment                     # reviewer feedback on reject
  confidence, availability
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
un-edited output.

## Phasing

- **Phase 1** ✅ — ReviewSubmission model + endpoints; Workspace "Send for
  Review" snapshot; Review Queue file-view; approve/send-back with KB ingestion.
- **Phase 2** ✅ — per-answer three-way decision UI in the Workspace.
- **Phase 3** 🔶 — notifications: backend done; bell/dropdown UI pending.
- **Phase 4** ✅ — "My Submissions" page (cycle lineage, resubmit, read-only
  history). Export within it is pending (Phase 5).
- **Phase 5** ⬜ — **Faithful export** (below).

## Phase 5 — Faithful export (pending, REQUIRED)

The exported file must reproduce the questionnaire **as uploaded** — sections,
subsections, sheet names, row order, original layout — with approved answers
written into the response column of the original rows.

Current `_export_xlsx` builds a NEW summary workbook and does NOT preserve
structure. Required approach:
1. **Persist the original uploaded file** at upload (bytes in Postgres/object
   storage keyed by doc_id). Currently discarded after parsing.
2. **At export, reopen the original** with openpyxl.
3. **Use `source_row`** (already captured by `parser.ExtractedItem`) to write
   each approved answer into the correct original row + response column.
4. **Preserve** sheets/sections/subsections/order/formatting by writing INTO the
   original rather than regenerating.

Parser already captures section, subsection, source_row, multi-sheet — so the
structural info exists. Missing: (a) persist the original file, (b) write-back
export.

## Open questions / risks

- **In-memory DOCUMENTS**: submissions snapshot the sheet, so they survive a
  DOCUMENTS reset. But the Workspace still loses un-submitted state on restart
  (pre-existing; candidate for future persistence).
- **Concurrent reviews**: two reviewers on one submission → last-write-wins
  (acceptable at current scale).
- **Timezone**: timestamps stored UTC; frontend appends `Z` when a tz marker is
  absent so relative times parse correctly. A cleaner fix is tz-aware columns
  (`TIMESTAMP WITH TIME ZONE`) — minor follow-up.
- **Two-user testing**: with `AUTH_DISABLED` all requests are `dev@local`, so
  submitter≠reviewer paths (access guards, notification routing) are untested
  locally. Verify on the deployed instance with real accounts.
- **Reviewer "suggested answer" ambiguity**: `corrected_answer` is only shown to
  the submitter as a reviewer suggestion when it differs from the answer (guards
  against carried-over text reading as a suggestion). A cleaner model would use a
  distinct `reviewer_suggested_answer` field.