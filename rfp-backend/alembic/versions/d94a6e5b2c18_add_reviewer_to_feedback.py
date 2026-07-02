"""add reviewer_email + reviewer_name to feedback_pairs

Stamps the approving reviewer when a Review-Queue approval produces a
FeedbackPair. Nullable — feedback from Slack, assistant, and direct
workspace corrections continues to leave these unset.

Revision ID: d94a6e5b2c18
Revises: c8d21a6f9e40
Create Date: 2026-07-02 07:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


revision: str = 'd94a6e5b2c18'
down_revision: Union[str, Sequence[str], None] = 'c8d21a6f9e40'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('feedback_pairs',
        sa.Column('reviewer_email', sqlmodel.sql.sqltypes.AutoString(), nullable=True))
    op.add_column('feedback_pairs',
        sa.Column('reviewer_name', sqlmodel.sql.sqltypes.AutoString(), nullable=True))


def downgrade() -> None:
    op.drop_column('feedback_pairs', 'reviewer_name')
    op.drop_column('feedback_pairs', 'reviewer_email')
