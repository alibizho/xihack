"""Durable read-only agent runs and replayable events."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0005_agent_runs_events"
down_revision = "0004_conversations_messages"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "agent_runs",
        sa.Column("run_id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("conversation_id", sa.String(length=36), nullable=False),
        sa.Column("user_message_id", sa.String(length=36), nullable=False),
        sa.Column("final_message_id", sa.String(length=36)),
        sa.Column("client_message_id", sa.String(length=128), nullable=False),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("phase", sa.String(length=32), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("worker_id", sa.String(length=36)),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True)),
        sa.Column("last_event_sequence", sa.Integer(), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=False),
        sa.Column("output_tokens", sa.Integer(), nullable=False),
        sa.Column("error_code", sa.String(length=64)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'completed', 'failed', 'cancelled')",
            name="ck_agent_runs_status",
        ),
        sa.CheckConstraint("attempt_count >= 0", name="ck_agent_runs_attempt_count"),
        sa.CheckConstraint("last_event_sequence >= 0", name="ck_agent_runs_last_event_sequence"),
        sa.ForeignKeyConstraint(["user_id"], ["users.user_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["conversation_id"], ["conversations.conversation_id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["user_message_id"], ["messages.message_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["final_message_id"], ["messages.message_id"], ondelete="SET NULL"),
        sa.UniqueConstraint("user_id", "client_message_id", name="uq_agent_runs_user_message"),
    )
    op.create_index("ix_agent_runs_queue", "agent_runs", ["status", "created_at"])
    op.create_index("ix_agent_runs_user_status", "agent_runs", ["user_id", "status"])
    op.create_table(
        "run_events",
        sa.Column("event_id", sa.String(length=36), primary_key=True),
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("payload", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("sequence > 0", name="ck_run_events_sequence_positive"),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.run_id"], ondelete="CASCADE"),
        sa.UniqueConstraint("run_id", "sequence", name="uq_run_events_run_sequence"),
    )
    op.create_index("ix_run_events_run_created", "run_events", ["run_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_run_events_run_created", table_name="run_events")
    op.drop_table("run_events")
    op.drop_index("ix_agent_runs_user_status", table_name="agent_runs")
    op.drop_index("ix_agent_runs_queue", table_name="agent_runs")
    op.drop_table("agent_runs")
