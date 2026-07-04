"""
auth.py — authentication & RBAC for the RFI Pilot API.

Identity comes from NextAuth (Google sign-in, domain-restricted) on the
frontend. The frontend mints a short-lived HS256 JWT at /api/token signed
with API_JWT_SECRET; this module verifies that signature and resolves the
user's ROLE server-side — the browser never decides its own permissions.

Roles and what they can do:

  capability         admin  reviewer  solutions_engineer  readonly
  ask                  x        x            x                x
  generate             x        x            x
  correct              x        x            x
  approve              x        x
  kb_read / kb_write   x        x            x
  export               x        x            x
  feedback_read        x        x            x
  manage_users         x
  manage_settings      x

User registry: a JSON file (USERS_FILE, default ./users.json — mount it on
a volume in deployment). Bootstrap admins via ADMIN_EMAILS (comma-separated);
unknown-but-authenticated users get DEFAULT_ROLE (default: readonly).

Dev escape hatch: AUTH_DISABLED=true makes every request an anonymous admin.
NEVER set this in production; if API_JWT_SECRET is missing and auth is not
explicitly disabled, the API fails closed with a clear error.
"""

import os
import json
import threading
from datetime import datetime, timezone
from dataclasses import dataclass
from pathlib import Path

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

ROLES = ("admin", "solutions_engineer", "reviewer", "readonly")

# Role spec (strictly hierarchical — one role per user):
#   admin               everything, incl. user management & settings
#   reviewer            everything except settings (incl. review/approve)
#   solutions_engineer  everything except review and settings
#   readonly            Assistant only (can ask questions, nothing else)
CAPABILITIES: dict[str, set[str]] = {
    "admin":              {"ask", "generate", "correct", "approve", "kb_read", "kb_write",
                           "export", "feedback_read", "manage_users", "manage_settings"},
    "reviewer":           {"ask", "generate", "correct", "approve", "kb_read", "kb_write",
                           "export", "feedback_read"},
    "solutions_engineer": {"ask", "generate", "correct", "kb_read", "kb_write",
                           "export", "feedback_read"},
    "readonly":           {"ask"},
}

USERS_FILE = Path(os.getenv("USERS_FILE", str(Path(__file__).parent / "users.json")))
_lock = threading.Lock()


@dataclass
class User:
    email: str
    name: str
    role: str

    @property
    def capabilities(self) -> set[str]:
        return CAPABILITIES.get(self.role, set())

    def can(self, capability: str) -> bool:
        return capability in self.capabilities


# ── User registry (Postgres via SQLModel) ────────────────────

from sqlmodel import Session, select
from database import engine
from models import User as UserRow   # SQLModel table (distinct from the dataclass)


def list_users() -> list[dict]:
    with Session(engine) as s:
        rows = s.exec(select(UserRow).order_by(UserRow.email)).all()
        return [
            {"email": r.email, "role": r.role, "name": r.name,
             "updated_at": r.updated_at.isoformat() if r.updated_at else None}
            for r in rows
        ]


def upsert_user(email: str, role: str, added_by: str) -> dict:
    if role not in ROLES:
        raise HTTPException(400, f"Unknown role '{role}'. Valid roles: {', '.join(ROLES)}")
    email = email.strip().lower()
    if not email or "@" not in email:
        raise HTTPException(400, "A valid email is required")
    with Session(engine) as s:
        row = s.get(UserRow, email)
        if row is None:
            row = UserRow(email=email, role=role)
            s.add(row)
        else:
            row.role = role
        row.updated_at = datetime.now(timezone.utc)
        s.commit()
        s.refresh(row)
        return {"email": row.email, "role": row.role,
                "updated_by": added_by,
                "updated_at": row.updated_at.isoformat()}


def delete_user(email: str) -> None:
    email = email.strip().lower()
    with Session(engine) as s:
        row = s.get(UserRow, email)
        if row:
            s.delete(row)
            s.commit()


def resolve_role(email: str) -> str:
    """Role precedence: explicit registry entry > ADMIN_EMAILS bootstrap > DEFAULT_ROLE."""
    email = email.lower()
    with Session(engine) as s:
        row = s.get(UserRow, email)
        if row:
            return row.role
    admin_emails = {e.strip().lower() for e in os.getenv("ADMIN_EMAILS", "").split(",") if e.strip()}
    if email in admin_emails:
        return "admin"
    default = os.getenv("DEFAULT_ROLE", "readonly")
    return default if default in ROLES else "readonly"


def reviewer_emails() -> set[str]:
    """Emails that should be notified as reviewers of a new submission.

    Union of two sources, because roles come from two places:
      (a) registered reviewer/admin rows in the users table, and
      (b) ADMIN_EMAILS bootstrap admins (who never get a table row but do
          resolve to "admin" at request time via resolve_role).

    Without (b), a deployment whose only reviewer is an ADMIN_EMAILS admin
    would never fire submission_received — the fan-out would iterate an
    empty list. Lower-cased for consistent comparison.
    """
    registered = {
        u["email"].lower()
        for u in list_users()
        if u["role"] in ("reviewer", "admin")
    }
    bootstrap = {
        e.strip().lower()
        for e in os.getenv("ADMIN_EMAILS", "").split(",")
        if e.strip()
    }
    return registered | bootstrap


# ── FastAPI dependencies ──────────────────────────────────────

_bearer = HTTPBearer(auto_error=False)


def current_user(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> User:
    if os.getenv("AUTH_DISABLED", "").lower() == "true":
        return User(email="dev@local", name="Dev (auth disabled)", role="admin")

    secret = os.getenv("API_JWT_SECRET")
    if not secret:
        raise HTTPException(
            500,
            "API_JWT_SECRET is not configured. Set it (same value as the frontend) "
            "or set AUTH_DISABLED=true for local development only.",
        )

    if creds is None:
        raise HTTPException(401, "Missing Authorization header")

    try:
        payload = jwt.decode(
            creds.credentials, secret,
            algorithms=["HS256"],                    # pin algorithm — block alg confusion
            options={"require": ["exp", "sub", "iat"]},  # reject tokens without expiry
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")

    email = (payload.get("sub") or "").lower()
    if not email:
        raise HTTPException(401, "Token has no subject")

    return User(email=email, name=payload.get("name") or email, role=resolve_role(email))


def require(capability: str):
    """Dependency factory: require(capability) → injects the User or raises 403."""
    def dep(user: User = Depends(current_user)) -> User:
        if not user.can(capability):
            raise HTTPException(
                403,
                f"Your role ({user.role}) does not include '{capability}'. "
                f"Ask an admin to change your role.",
            )
        return user
    return dep
