"""add review column names

Adds three column-name fields to review_submissions so the Phase 5 export
endpoint knows which column headers to look up in the persisted original
workbook (question column, availability write-target, remarks write-target).

Revision ID: b7c92e4f0d31
Revises: e5f1a8d9c4b2
Create Date: 2026-07-01 20:45:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = 'b7c92e4f0d31'
down_revision: Union[str, Sequence[str], None] = 'e5f1a8d9c4b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('review_submissions',
        sa.Column('question_col_name', sqlmodel.sql.sqltypes.AutoString(), nullable=True))
    op.add_column('review_submissions',
        sa.Column('availability_col_name', sqlmodel.sql.sqltypes.AutoString(), nullable=True))
    op.add_column('review_submissions',
        sa.Column('remarks_col_name', sqlmodel.sql.sqltypes.AutoString(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('review_submissions', 'remarks_col_name')
    op.drop_column('review_submissions', 'availability_col_name')
    op.drop_column('review_submissions', 'question_col_name')
