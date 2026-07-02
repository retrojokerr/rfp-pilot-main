"""
models.py — SQLModel table definitions.
Each class is both a Pydantic model (for API validation) and a DB table.

Tables:
  users              — replaces users.json
  history            — replaces history.json
  feedback_pairs     — replaces feedback_log.jsonl
  review_submissions — new: per-sheet review workflow (Phase 1)
  review_items       — new: per-answer items within a submission
  notifications      — new: in-app notifications (Phase 3)
"""
from __future__ import annotations
from typing import Optional
from datetime import datetime, timezone
from sqlmodel import SQLModel, Field, Column
from sqlalchemy import Text, JSON, LargeBinary
import uuid


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _uuid() -> str:
    return str(uuid.uuid4())


# ── Users ─────────────────────────────────────────────────────────────────────

class User(SQLModel, table=True):
    __tablename__ = "users"

    email: str = Field(primary_key=True)
    name: Optional[str] = None
    role: str = Field(default="readonly")
    created_at: datetime = Field(default_factory=_now)
    updated_at: datetime = Field(default_factory=_now)


# ── History ───────────────────────────────────────────────────────────────────

class HistoryEntry(SQLModel, table=True):
    __tablename__ = "history"

    id: str = Field(default_factory=_uuid, primary_key=True)
    owner: str  # email
    filename: str
    row_count: int = 0
    generated_at: datetime = Field(default_factory=_now)
    # Store the full entry payload as JSON (flexible, mirrors current structure)
    payload: dict = Field(default_factory=dict, sa_column=Column(JSON))


# ── Feedback ──────────────────────────────────────────────────────────────────

class FeedbackPair(SQLModel, table=True):
    __tablename__ = "feedback_pairs"

    id: str = Field(default_factory=_uuid, primary_key=True)
    question: str = Field(sa_column=Column(Text))
    bad_answer: Optional[str] = Field(default=None, sa_column=Column(Text))
    good_answer: str = Field(sa_column=Column(Text))
    section: Optional[str] = None
    availability: Optional[str] = None
    confidence: Optional[float] = None
    signal: Optional[str] = None   # approved | rejected | thumbs_up | thumbs_down | correction
    source: Optional[str] = None   # slack | workspace | assistant | review_queue
    user_name: Optional[str] = None    # display name of who gave the feedback
    user_email: Optional[str] = None   # email of who gave the feedback
    # When the correction came in via Review Queue approval, stamp the
    # reviewer who approved it. Nullable — feedback from other sources
    # (Slack, assistant, workspace direct) leaves these null.
    reviewer_email: Optional[str] = None
    reviewer_name: Optional[str] = None
    created_at: datetime = Field(default_factory=_now)


# ── Review Submissions (Phase 1) ──────────────────────────────────────────────

class ReviewSubmission(SQLModel, table=True):
    __tablename__ = "review_submissions"

    id: str = Field(default_factory=_uuid, primary_key=True)
    doc_id: str                         # workspace document id
    sheet_name: str
    submitted_by: str                   # email
    submitted_at: datetime = Field(default_factory=_now)
    status: str = Field(default="pending")  # pending | approved | sent_back
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    reviewer_comment: Optional[str] = Field(default=None, sa_column=Column(Text))
    previous_submission_id: Optional[str] = Field(default=None, index=True)
    cycle: int = Field(default=1)  # 1 = first submission, increments on resubmit
    # Phase 5: column-name pointers into the persisted OriginalDocument, so
    # the export endpoint knows where to look up the question text and where
    # to write availability + remarks values. Nullable — legacy submissions
    # (created before Phase 5) have NULL here and can't be exported.
    question_col_name: Optional[str] = None
    availability_col_name: Optional[str] = None
    remarks_col_name: Optional[str] = None
    # Human-friendly RFP label the user provides at upload time. Optional —
    # UI falls back to sheet_name when not set.
    display_name: Optional[str] = None


class ReviewItem(SQLModel, table=True):
    __tablename__ = "review_items"

    id: str = Field(default_factory=_uuid, primary_key=True)
    submission_id: str = Field(foreign_key="review_submissions.id", index=True)
    question_id: str
    question: str = Field(sa_column=Column(Text))
    section: Optional[str] = None
    answer: str = Field(sa_column=Column(Text))          # current answer
    original_answer: str = Field(sa_column=Column(Text)) # AI first draft
    corrected_answer: Optional[str] = Field(default=None, sa_column=Column(Text))
    flag_type: str = Field(default="untouched")
    # accepted | corrected | flagged | rejected | untouched
    decision: Optional[str] = None      # approved | rejected
    comment: Optional[str] = Field(default=None, sa_column=Column(Text))
    confidence: Optional[float] = None
    availability: Optional[str] = None
    # Positional metadata captured at parse time so the Phase-5 export endpoint
    # can write each approved answer back into the *original* workbook at the
    # exact (sheet, row, column) it came from. All nullable — legacy items
    # (created before Phase 5) simply won't be write-back-eligible.
    sheet_name: Optional[str] = None
    source_row: Optional[int] = None
    source_col: Optional[int] = None


# ── Notifications (Phase 3) ───────────────────────────────────────────────────

class Notification(SQLModel, table=True):
    __tablename__ = "notifications"

    id: str = Field(default_factory=_uuid, primary_key=True)
    user_email: str = Field(index=True)
    type: str          # submission_received | submission_approved | submission_sent_back
    message: str
    link: Optional[str] = None
    read: bool = Field(default=False)
    created_at: datetime = Field(default_factory=_now)


# ── Original documents (Phase 5) ──────────────────────────────────────────────

class OriginalDocument(SQLModel, table=True):
    """
    Raw bytes of an uploaded workbook, keyed by doc_id. Populated at upload
    time; read by the review-workflow export endpoint to write approved
    answers back into the original sheet structure (sections, subsections,
    formatting, multi-sheet layout) instead of building a summary workbook.

    Kept in Postgres (bytea) for now — pilot-scale RFP files are typically
    1-5 MB; swap for S3 later behind the same doc_id key if files grow.
    """
    __tablename__ = "original_documents"

    doc_id: str = Field(primary_key=True)
    filename: str
    content_type: str          # "xlsx" | "xls" | "csv"
    content: bytes = Field(sa_column=Column(LargeBinary))
    uploaded_by: str           # email
    uploaded_at: datetime = Field(default_factory=_now)
