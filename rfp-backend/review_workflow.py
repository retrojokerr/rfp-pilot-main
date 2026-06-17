"""
review_workflow.py — Phase 1 of the document-centric review workflow.

A submission is a snapshot of a sheet + its answers, handed from a submitter
to a reviewer as one unit. See REVIEW_WORKFLOW_DESIGN.md.

KB ingestion invariant:
  - corrected items ingest to Qdrant ONLY here, on approval
  - rejected items never ingest
  - "accepted" (path-1, KB-direct) items already ingested at generation time
"""
from __future__ import annotations
from typing import Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session, select

from database import engine
from models import ReviewSubmission, ReviewItem, Notification
from auth import require, current_user, User

router = APIRouter(prefix="/review", tags=["review"])


def _now():
    return datetime.now(timezone.utc)


class ReviewItemIn(BaseModel):
    question_id: str
    question: str
    section: Optional[str] = None
    answer: str
    original_answer: Optional[str] = None
    corrected_answer: Optional[str] = None
    flag_type: str = "untouched"
    confidence: Optional[float] = None
    availability: Optional[str] = None


class SubmissionIn(BaseModel):
    doc_id: str
    sheet_name: str
    items: list[ReviewItemIn]


class ItemDecision(BaseModel):
    question_id: str
    decision: str
    corrected_answer: Optional[str] = None
    comment: Optional[str] = None


class SendBackIn(BaseModel):
    decisions: list[ItemDecision]
    reviewer_comment: Optional[str] = None


def _notify(session: Session, user_email: str, ntype: str, message: str, link: str):
    session.add(Notification(user_email=user_email, type=ntype, message=message, link=link))


def _serialize(sub: ReviewSubmission, items: list[ReviewItem]) -> dict:
    return {
        "id": sub.id,
        "doc_id": sub.doc_id,
        "sheet_name": sub.sheet_name,
        "submitted_by": sub.submitted_by,
        "submitted_at": sub.submitted_at.isoformat() if sub.submitted_at else None,
        "status": sub.status,
        "reviewed_by": sub.reviewed_by,
        "reviewed_at": sub.reviewed_at.isoformat() if sub.reviewed_at else None,
        "reviewer_comment": sub.reviewer_comment,
        "items": [{
            "question_id": i.question_id,
            "question": i.question,
            "section": i.section,
            "answer": i.answer,
            "original_answer": i.original_answer,
            "corrected_answer": i.corrected_answer,
            "flag_type": i.flag_type,
            "decision": i.decision,
            "comment": i.comment,
            "confidence": i.confidence,
            "availability": i.availability,
        } for i in items],
        "counts": {
            "total": len(items),
            "corrected": sum(1 for i in items if i.flag_type == "corrected"),
            "flagged": sum(1 for i in items if i.flag_type == "flagged"),
            "accepted": sum(1 for i in items if i.flag_type == "accepted"),
        },
    }


@router.post("/submissions")
def create_submission(payload: SubmissionIn, user: User = Depends(require("generate"))):
    touched = [it for it in payload.items if it.flag_type in ("corrected", "flagged")]
    if not touched:
        raise HTTPException(400, "A submission needs at least one corrected or flagged answer")
    with Session(engine) as s:
        sub = ReviewSubmission(
            doc_id=payload.doc_id, sheet_name=payload.sheet_name,
            submitted_by=user.email, status="pending",
        )
        s.add(sub)
        s.flush()
        for it in payload.items:
            s.add(ReviewItem(
                submission_id=sub.id, question_id=it.question_id, question=it.question,
                section=it.section, answer=it.answer,
                original_answer=it.original_answer or it.answer,
                corrected_answer=it.corrected_answer, flag_type=it.flag_type,
                confidence=it.confidence, availability=it.availability,
            ))
        from auth import list_users
        reviewers = [u["email"] for u in list_users() if u["role"] in ("reviewer", "admin")]
        for r_email in reviewers:
            if r_email != user.email:
                _notify(s, r_email, "submission_received",
                        f"{user.name or user.email} sent '{payload.sheet_name}' for review",
                        f"/review-queue?submission={sub.id}")
        s.commit()
        s.refresh(sub)
        items = s.exec(select(ReviewItem).where(ReviewItem.submission_id == sub.id)).all()
        return _serialize(sub, items)


@router.get("/submissions")
def list_submissions(user: User = Depends(current_user)):
    with Session(engine) as s:
        q = select(ReviewSubmission).order_by(ReviewSubmission.submitted_at.desc())
        if user.role not in ("reviewer", "admin"):
            q = q.where(ReviewSubmission.submitted_by == user.email)
        subs = s.exec(q).all()
        out = []
        for sub in subs:
            items = s.exec(select(ReviewItem).where(ReviewItem.submission_id == sub.id)).all()
            out.append(_serialize(sub, items))
        return {"submissions": out}


@router.get("/submissions/{submission_id}")
def get_submission(submission_id: str, user: User = Depends(current_user)):
    with Session(engine) as s:
        sub = s.get(ReviewSubmission, submission_id)
        if not sub:
            raise HTTPException(404, "Submission not found")
        if user.role not in ("reviewer", "admin") and sub.submitted_by != user.email:
            raise HTTPException(403, "Not your submission")
        items = s.exec(select(ReviewItem).where(ReviewItem.submission_id == sub.id)).all()
        return _serialize(sub, items)


@router.post("/submissions/{submission_id}/approve")
def approve_submission(submission_id: str, user: User = Depends(require("approve"))):
    with Session(engine) as s:
        sub = s.get(ReviewSubmission, submission_id)
        if not sub:
            raise HTTPException(404, "Submission not found")
        if sub.status != "pending":
            raise HTTPException(400, f"Submission is already {sub.status}")
        items = s.exec(select(ReviewItem).where(ReviewItem.submission_id == sub.id)).all()
        ingested = 0
        for it in items:
            answer_to_ingest = it.corrected_answer or (it.answer if it.flag_type == "corrected" else None)
            if it.flag_type in ("corrected", "flagged") and answer_to_ingest:
                try:
                    from ingest import ingest_correction
                    ingest_correction(it.question, answer_to_ingest, it.section or "", "review_queue")
                    it.decision = "approved"
                    ingested += 1
                except Exception as e:
                    print(f"  [review] KB ingest failed for {it.question_id}: {e}")
        sub.status = "approved"
        sub.reviewed_by = user.email
        sub.reviewed_at = _now()
        _notify(s, sub.submitted_by, "submission_approved",
                f"Your sheet '{sub.sheet_name}' was approved",
                f"/my-submissions?submission={sub.id}")
        s.commit()
        s.refresh(sub)
        return {"status": "approved", "ingested": ingested, "submission_id": sub.id}


@router.post("/submissions/{submission_id}/send-back")
def send_back_submission(submission_id: str, payload: SendBackIn, user: User = Depends(require("approve"))):
    rejected = [d for d in payload.decisions if d.decision == "rejected"]
    if not rejected:
        raise HTTPException(400, "Send-back requires at least one rejected answer")
    for d in rejected:
        if not (d.corrected_answer or d.comment):
            raise HTTPException(400, f"Rejected answer {d.question_id} needs a correction or comment")
    with Session(engine) as s:
        sub = s.get(ReviewSubmission, submission_id)
        if not sub:
            raise HTTPException(404, "Submission not found")
        if sub.status != "pending":
            raise HTTPException(400, f"Submission is already {sub.status}")
        items = {i.question_id: i for i in s.exec(select(ReviewItem).where(ReviewItem.submission_id == sub.id)).all()}
        for d in payload.decisions:
            it = items.get(d.question_id)
            if not it:
                continue
            it.decision = d.decision
            if d.corrected_answer:
                it.corrected_answer = d.corrected_answer
            if d.comment:
                it.comment = d.comment
        sub.status = "sent_back"
        sub.reviewed_by = user.email
        sub.reviewed_at = _now()
        sub.reviewer_comment = payload.reviewer_comment
        _notify(s, sub.submitted_by, "submission_sent_back",
                f"Your sheet '{sub.sheet_name}' was sent back with feedback",
                f"/my-submissions?submission={sub.id}")
        s.commit()
        return {"status": "sent_back", "submission_id": sub.id}
