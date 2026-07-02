"""add display_name to review_submissions

Human-friendly RFP label captured at upload time. Nullable — legacy rows
fall back to sheet_name in the UI.

Revision ID: c8d21a6f9e40
Revises: b7c92e4f0d31
Create Date: 2026-07-01 21:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


revision: str = 'c8d21a6f9e40'
down_revision: Union[str, Sequence[str], None] = 'b7c92e4f0d31'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('review_submissions',
        sa.Column('display_name', sqlmodel.sql.sqltypes.AutoString(), nullable=True))


def downgrade() -> None:
    op.drop_column('review_submissions', 'display_name')
