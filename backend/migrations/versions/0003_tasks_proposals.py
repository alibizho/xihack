"""Account-scoped tasks and confirmation proposals."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0003_tasks_proposals"
down_revision = "0002_identity_sessions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tasks",
        sa.Column("task_id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.user_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("description", sa.Text()),
        sa.Column("category", sa.String(64)),
        sa.Column("due_precision", sa.String(8)),
        sa.Column("due_date", sa.Date()),
        sa.Column("due_at", sa.DateTime(timezone=True)),
        sa.Column("due_timezone", sa.String(64)),
        sa.Column("important", sa.Boolean(), nullable=False),
        sa.Column("urgent", sa.Boolean(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("version >= 1", name="ck_tasks_version_positive"),
        sa.CheckConstraint("status IN ('open', 'completed')", name="ck_tasks_status"),
        sa.CheckConstraint(
            "(due_precision IS NULL AND due_date IS NULL AND due_at IS NULL AND due_timezone IS NULL) "
            "OR (due_precision = 'date' AND due_date IS NOT NULL AND due_at IS NULL AND due_timezone IS NOT NULL) "
            "OR (due_precision = 'minute' AND due_date IS NOT NULL AND due_at IS NOT NULL AND due_timezone IS NOT NULL)",
            name="ck_tasks_due_shape",
        ),
    )
    op.create_index("ix_tasks_user_created", "tasks", ["user_id", "created_at", "task_id"])
    op.create_index("ix_tasks_user_due_date", "tasks", ["user_id", "due_date"])
    op.create_table(
        "proposals",
        sa.Column("proposal_id", sa.String(36), primary_key=True),
        sa.Column(
            "user_id",
            sa.String(36),
            sa.ForeignKey("users.user_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("client_request_id", sa.String(128), nullable=False),
        sa.Column("request_fingerprint", sa.String(64), nullable=False),
        sa.Column("source", sa.String(16), nullable=False),
        sa.Column("operation", sa.String(16), nullable=False),
        sa.Column("task_id", sa.String(36)),
        sa.Column("expected_version", sa.Integer()),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("confirm_key_hash", sa.String(64)),
        sa.Column("receipt", postgresql.JSONB()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "client_request_id", name="uq_proposals_user_request"),
        sa.CheckConstraint(
            "operation IN ('create', 'update', 'complete', 'delete')", name="ck_proposals_operation"
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'confirmed', 'cancelled', 'invalidated')",
            name="ck_proposals_status",
        ),
    )
    op.create_index("ix_proposals_user_task_status", "proposals", ["user_id", "task_id", "status"])


def downgrade() -> None:
    op.drop_index("ix_proposals_user_task_status", table_name="proposals")
    op.drop_table("proposals")
    op.drop_index("ix_tasks_user_due_date", table_name="tasks")
    op.drop_index("ix_tasks_user_created", table_name="tasks")
    op.drop_table("tasks")
