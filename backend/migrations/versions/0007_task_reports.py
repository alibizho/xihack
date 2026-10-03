"""Store one completion report and bounded analysis attempts per task."""

from alembic import op
import sqlalchemy as sa


revision = "0007_task_reports"
down_revision = "0006_conversation_titles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "task_reports",
        sa.Column("report_id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("task_id", sa.String(length=36), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("summary", sa.String(length=240)),
        sa.Column("blocker", sa.String(length=240)),
        sa.Column("next_step", sa.String(length=240)),
        sa.Column("analysis_attempts", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("analyzed_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint("analysis_attempts BETWEEN 0 AND 3", name="ck_task_reports_attempts"),
        sa.ForeignKeyConstraint(["user_id"], ["users.user_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["task_id"], ["tasks.task_id"], ondelete="CASCADE"),
        sa.UniqueConstraint("user_id", "task_id", name="uq_task_reports_user_task"),
    )
    op.create_index("ix_task_reports_user_created", "task_reports", ["user_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_task_reports_user_created", table_name="task_reports")
    op.drop_table("task_reports")
