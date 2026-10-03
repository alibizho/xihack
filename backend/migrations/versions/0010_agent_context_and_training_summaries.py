"""Store compact training summaries and structured Agent results."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0010_agent_context_training"
down_revision = "0009_agent_proposal_batches"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "agent_runs",
        sa.Column("structured_result", postgresql.JSONB(), nullable=True),
    )
    op.create_table(
        "training_round_summaries",
        sa.Column("summary_id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("client_round_id", sa.String(length=36), nullable=False),
        sa.Column("day_period", sa.String(length=16), nullable=False),
        sa.Column("difficulty", sa.String(length=16), nullable=False),
        sa.Column("variant", sa.String(length=16), nullable=False),
        sa.Column("duration_seconds", sa.Float(), nullable=False),
        sa.Column("mistakes", sa.Integer(), nullable=False),
        sa.Column("average_step_seconds", sa.Float(), nullable=False),
        sa.Column("first_half_seconds", sa.Float(), nullable=False),
        sa.Column("second_half_seconds", sa.Float(), nullable=False),
        sa.Column("max_pause_seconds", sa.Float(), nullable=False),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("day_period IN ('morning', 'afternoon', 'evening', 'night')", name="ck_training_summary_period"),
        sa.CheckConstraint("difficulty IN ('beginner', 'normal', 'advanced')", name="ck_training_summary_difficulty"),
        sa.CheckConstraint("variant IN ('grid', 'circle')", name="ck_training_summary_variant"),
        sa.CheckConstraint("duration_seconds > 0 AND duration_seconds <= 1200", name="ck_training_summary_duration"),
        sa.CheckConstraint("mistakes BETWEEN 0 AND 500", name="ck_training_summary_mistakes"),
        sa.ForeignKeyConstraint(["user_id"], ["users.user_id"], ondelete="CASCADE"),
        sa.UniqueConstraint("user_id", "client_round_id", name="uq_training_summary_user_round"),
    )
    op.create_index("ix_training_summary_user_completed", "training_round_summaries", ["user_id", "completed_at"])


def downgrade() -> None:
    op.drop_index("ix_training_summary_user_completed", table_name="training_round_summaries")
    op.drop_table("training_round_summaries")
    op.drop_column("agent_runs", "structured_result")
