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
from sqlalchemy import Text, JSON
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
