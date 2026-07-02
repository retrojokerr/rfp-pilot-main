"""phase 5 faithful export

Adds original_documents table (raw uploaded-workbook bytes keyed by doc_id)
and positional metadata columns on review_items (sheet_name, source_row,
source_col) so the export endpoint can write approved answers back into the
original workbook at the exact cell they came from.

Revision ID: e5f1a8d9c4b2
Revises: 0a9bf882bd8b
Create Date: 2026-07-01 20:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import sqlmodel


# revision identifiers, used by Alembic.
revision: str = 'e5f1a8d9c4b2'
down_revision: Union[str, Sequence[str], None] = '0a9bf882bd8b'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # New table for persisted original uploads (Phase 5 faithful export).
    op.create_table(
        'original_documents',
        sa.Column('doc_id', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('filename', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('content_type', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('content', sa.LargeBinary(), nullable=False),
        sa.Column('uploaded_by', sqlmodel.sql.sqltypes.AutoString(), nullable=False),
        sa.Column('uploaded_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('doc_id'),
    )

    # Positional metadata on review_items so export can locate the exact cell.
    # All nullable — legacy items (pre-Phase-5) won't have them and are simply
    # not write-back-eligible; the export endpoint 409s in that case.
    op.add_column('review_items',
        sa.Column('sheet_name', sqlmodel.sql.sqltypes.AutoString(), nullable=True))
    op.add_column('review_items',
        sa.Column('source_row', sa.Integer(), nullable=True))
    op.add_column('review_items',
        sa.Column('source_col', sa.Integer(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('review_items', 'source_col')
    op.drop_column('review_items', 'source_row')
    op.drop_column('review_items', 'sheet_name')
    op.drop_table('original_documents')
