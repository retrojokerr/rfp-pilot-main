# Document-Centric Review Workflow — Design

Status: proposed. Replaces the current per-question review model with a
per-sheet (submission) review workflow, plus in-app notifications and an
approved-sheets view for submitters.

## Why

Today the unit of review is a single answer (`responses[]`, each with its own
status). Real RFP review is document-centric: a person works a whole sheet,
then hands it to a reviewer as one package. This redesign makes the
**submission** (a snapshot of a sheet + its answers) the unit of review.

## Roles

- **Submitter** — anyone with `generate` (solutions_engineer, reviewer, admin).
  Works the sheet, decides per-answer what happens, submits for review.
- **Reviewer** — `reviewer` + `admin`. Reviews submissions, edits/approves/
  rejects, triggers KB ingestion on approval, exports.

## Per-answer decision (Workspace, after generation)

For each generated answer the submitter picks one of three paths:

1. **Send to KB directly** — correction ingested immediately as a golden
   answer (current behavior). Shows in Feedback Loop. Not reviewed.
2. **Correct + send for review** — correction is staged but NOT ingested.
   KB ingestion is deferred until a reviewer approves.
3. **Flag for review (no correction)** — submitter is unsure; wants a second
   opinion. Answer unchanged, tagged "flagged".

### Submission rule

- If **all** answers are path 1 (KB-direct) → no submission; sheet ships.
- If **any** answer is path 2 or 3 → the whole sheet becomes one
  **ReviewSubmission**.
- In a mixed sheet, path-1 answers are included in the submission but
  **tagged "accepted"** — visible to the reviewer for context, not actionable.

## Reviewer experience (Review Queue → file view)

The Review Queue changes from question-cards to **submission-cards**:

> Sheet: `[CSB Bank] Use Cases.xlsx` · submitted by Subandhu · 2h ago
> 12 questions · 3 corrected · 1 flagged · 8 accepted

Opening a submission shows the **whole sheet**:
- **Touched** answers (corrected / flagged) are highlighted as needing attention.
- **Accepted** (path-1) answers are shown, dimmed, non-actionable.
- **Untouched** answers shown normally; implicitly accepted on approval.

Per touched answer, the reviewer can:
- **Edit** (correct further), then approve
- **Approve** as-is
- **Reject** — requires EITHER a corrected answer OR a comment (mandatory).
  Rejecting any answer flags the sheet to go back to the submitter.

### Sheet-level outcome

- **Approve sheet** — all touched answers approved. KB ingestion happens now
  for every corrected answer in the submission (path 2 + reviewer edits).
  Success prompt. Reviewer can export. Submitter notified.
- **Send back** — if any answer was rejected (with correction/comment), the
  whole submission returns to the submitter with that feedback. Submitter
  addresses it and re-submits (new review cycle).

## Submitter experience after review

A new **"My Submissions"** page (for users with `generate`):
- Lists their submissions with status: pending / approved / sent-back.
- **Approved** → can view the final sheet (with changes highlighted) and export.
- **Sent back** → sees reviewer's rejections/comments, can edit + re-submit.

## Notifications (in-app only, v1)

- **On submit** → reviewers see a dashboard notification: "New sheet for
  review from {submitter}".
- **On approve / send-back** → submitter sees a notification: "Your sheet
  {name} was approved / sent back".
- Implemented as a lightweight `notifications` list per user (bell icon +
  dashboard widget). No email/Slack in v1.

## Data model

```
ReviewSubmission {
  id
  doc_id            # the workspace document
  sheet_name
  submitted_by      # email
  submitted_at
  status            # pending | approved | sent_back
  reviewed_by       # email, null until acted on
  reviewed_at
  items: [ ReviewItem ]
}

ReviewItem {
  question_id
  question
  section
  answer            # current answer text
  original_answer   # AI's first draft (for change highlighting)
  corrected_answer  # submitter or reviewer correction, if any
  flag_type         # accepted | corrected | flagged | rejected
  decision          # null | approved | rejected
  comment           # required when rejected without a correction
  confidence
}

Notification {
  id, user_email, type, message, link, read, created_at
}
```

Storage: JSON files on the existing `feedback_data` volume
(`review_submissions.json`, `notifications.json`), mirroring the current
review_queue/feedback pattern. (Postgres is the eventual upgrade.)

## KB ingestion rules (the critical invariant)

- Path 1 (KB-direct): ingest immediately. ✅ today's behavior.
- Path 2 (correct + review): ingest ONLY when the reviewer approves the sheet.
- Path 3 (flag, no correction): no ingestion unless the reviewer supplies a
  correction and approves.
- Rejected answer: never ingested.

This guarantees the KB only ever learns reviewer-blessed corrections (except
the explicit fast-path #1, which is a deliberate trust shortcut).

## Phasing (ship + test independently)

- **Phase 1** — ReviewSubmission model + endpoints; Workspace "Send for
  Review" snapshot; Review Queue file-view; reviewer approve/send-back with
  KB ingestion on approval. (The core.)
- **Phase 2** — per-answer three-way decision UI in Workspace with tags.
- **Phase 3** — in-app notifications (bell + dashboard widget).
- **Phase 4** — "My Submissions" page for submitters (view changes, export).

## Open questions / risks

- **In-memory DOCUMENTS**: submissions snapshot the sheet, so they survive
  even if the live DOCUMENTS dict resets — good. But the Workspace itself
  still loses un-submitted state on restart (pre-existing limitation).
- **Concurrent reviews**: two reviewers opening the same submission. v1 =
  last-write-wins (acceptable at current scale).
- **Re-submission loop**: a sheet sent back then re-submitted creates a new
  review cycle; keep the prior cycle's comments visible for context.
- **Migration**: the current `review_queue.json` (per-answer) doesn't map
  cleanly to submissions. v1 likely starts the new model fresh; old items
  stay viewable in a legacy view or are dropped.