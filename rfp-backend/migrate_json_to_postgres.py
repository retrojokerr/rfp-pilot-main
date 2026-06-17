"""
One-time migration: JSON files → Postgres (Neon).
Run once: python3 migrate_json_to_postgres.py
Safe to re-run — skips existing records.
"""
import json
import os
from pathlib import Path
from datetime import datetime, timezone
from dotenv import load_dotenv
load_dotenv()

from sqlmodel import Session, select
from database import engine
from models import User, HistoryEntry, FeedbackPair

def _now():
    return datetime.now(timezone.utc)

def migrate_users():
    users_file = Path("users.json")
    if not users_file.exists():
        print("users.json not found — skipping")
        return
    data = json.loads(users_file.read_text())
    if not data:
        print("users.json is empty — skipping")
        return
    # users.json is either a dict {email: {role, name}} or a list
    if isinstance(data, dict):
        users = [{"email": k, **v} for k, v in data.items()]
    else:
        users = data
    with Session(engine) as session:
        inserted = 0
        for u in users:
            email = u.get("email")
            if not email:
                continue
            existing = session.get(User, email)
            if existing:
                continue
            session.add(User(
                email=email,
                name=u.get("name"),
                role=u.get("role", "readonly"),
            ))
            inserted += 1
        session.commit()
    print(f"users: inserted {inserted}")

def migrate_history():
    history_file = Path("history.json")
    if not history_file.exists():
        print("history.json not found — skipping")
        return
    data = json.loads(history_file.read_text())
    if not data:
        print("history.json is empty — skipping")
        return
    entries = data if isinstance(data, list) else [data]
    with Session(engine) as session:
        existing_ids = set(session.exec(select(HistoryEntry.id)).all())
        inserted = 0
        for e in entries:
            eid = e.get("id")
            if eid in existing_ids:
                continue
            session.add(HistoryEntry(
                id=eid or None,
                owner=e.get("owner", e.get("email", "unknown")),
                filename=e.get("filename", e.get("name", "unknown")),
                row_count=e.get("row_count", e.get("rowCount", 0)),
                generated_at=datetime.fromisoformat(
                    e["generated_at"].replace("Z", "+00:00")
                ) if e.get("generated_at") else _now(),
                payload=e,
            ))
            inserted += 1
        session.commit()
    print(f"history: inserted {inserted}")

def migrate_feedback():
    feedback_file = Path(os.getenv("FEEDBACK_LOG", "feedback_log.jsonl"))
    if not feedback_file.exists():
        print(f"{feedback_file} not found — skipping")
        return
    lines = [l.strip() for l in feedback_file.read_text().splitlines() if l.strip()]
    with Session(engine) as session:
        inserted = 0
        for line in lines:
            try:
                p = json.loads(line)
            except json.JSONDecodeError:
                continue
            # Deduplicate by question+source+created_at
            session.add(FeedbackPair(
                question=p.get("question", ""),
                bad_answer=p.get("bad_answer"),
                good_answer=p.get("good_answer", ""),
                section=p.get("section"),
                availability=p.get("availability"),
                confidence=p.get("confidence"),
                signal=p.get("signal"),
                source=p.get("source"),
                created_at=datetime.fromisoformat(
                    p["created_at"].replace("Z", "+00:00")
                ) if p.get("created_at") else _now(),
            ))
            inserted += 1
        session.commit()
    print(f"feedback: inserted {inserted}")

if __name__ == "__main__":
    print("Migrating JSON → Postgres...")
    migrate_users()
    migrate_history()
    migrate_feedback()
    print("Done.")
