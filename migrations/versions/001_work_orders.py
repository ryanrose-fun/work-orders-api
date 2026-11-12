"""Create work orders table."""

from alembic import op
import sqlalchemy as sa

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "work_orders",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.CheckConstraint("status IN ('queued','active','completed','cancelled')", name="valid_status"),
        sa.CheckConstraint("version >= 1", name="positive_version"),
    )


def downgrade():
    op.drop_table("work_orders")
