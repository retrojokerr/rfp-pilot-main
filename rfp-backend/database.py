"""
database.py — Postgres connection + session management (SQLModel/SQLAlchemy).
All tables are defined in models.py and imported here so Alembic can see them.
"""
import os
from sqlmodel import SQLModel, create_engine, Session
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL is not set — add it to .env or Doppler")

# pool_pre_ping=True reconnects after Neon scale-to-zero wakeup.
# connect_args sslmode is already in the URL from Neon, but we set it
# explicitly too for safety.
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    echo=False,  # set True temporarily to debug SQL
)


def get_session():
    """FastAPI dependency — yields a DB session per request."""
    with Session(engine) as session:
        yield session


def create_db_and_tables():
    """Create all tables that don't exist yet. Called at app startup."""
    SQLModel.metadata.create_all(engine)
