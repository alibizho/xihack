"""Replace task priority flags with 0–10 scores."""

from alembic import op
import sqlalchemy as sa


revision = "0008_numeric_task_scores"
down_revision = "0007_task_reports"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tasks", sa.Column("importance", sa.Numeric(3, 1), nullable=True))
    op.add_column("tasks", sa.Column("urgency", sa.Numeric(3, 1), nullable=True))
    op.execute(
        "UPDATE tasks SET importance = CASE WHEN important THEN 8.0 ELSE 4.0 END, "
        "urgency = CASE WHEN urgent THEN 8.0 ELSE 3.0 END"
    )
    op.alter_column("tasks", "importance", nullable=False)
    op.alter_column("tasks", "urgency", nullable=False)
    op.create_check_constraint("ck_tasks_importance_score", "tasks", "importance BETWEEN 0 AND 10")
    op.create_check_constraint("ck_tasks_urgency_score", "tasks", "urgency BETWEEN 0 AND 10")

    op.execute(
        """UPDATE proposals SET payload =
        (payload - 'important' - 'urgent') ||
        jsonb_build_object(
            'importance', CASE WHEN payload->>'important' = 'true' THEN 8.0 ELSE 4.0 END,
            'urgency', CASE WHEN payload->>'urgent' = 'true' THEN 8.0 ELSE 3.0 END
        ) WHERE operation = 'create'"""
    )
    op.execute(
        """UPDATE proposals SET payload =
        (payload - 'important' - 'urgent') ||
        CASE WHEN payload ? 'important' THEN
            jsonb_build_object('importance', CASE WHEN payload->>'important' = 'true' THEN 8.0 ELSE 4.0 END)
        ELSE '{}'::jsonb END ||
        CASE WHEN payload ? 'urgent' THEN
            jsonb_build_object('urgency', CASE WHEN payload->>'urgent' = 'true' THEN 8.0 ELSE 3.0 END)
        ELSE '{}'::jsonb END
        WHERE operation = 'update'"""
    )
    op.execute(
        """UPDATE proposals SET receipt = jsonb_set(receipt, '{task}',
        ((receipt->'task') - 'important' - 'urgent') ||
        jsonb_build_object(
            'importance', CASE WHEN receipt->'task'->>'important' = 'true' THEN 8.0 ELSE 4.0 END,
            'urgency', CASE WHEN receipt->'task'->>'urgent' = 'true' THEN 8.0 ELSE 3.0 END
        )) WHERE jsonb_typeof(receipt->'task') = 'object'"""
    )
    op.drop_column("tasks", "important")
    op.drop_column("tasks", "urgent")


def downgrade() -> None:
    op.add_column("tasks", sa.Column("important", sa.Boolean(), nullable=True))
    op.add_column("tasks", sa.Column("urgent", sa.Boolean(), nullable=True))
    op.execute("UPDATE tasks SET important = importance >= 6, urgent = urgency >= 6")
    op.alter_column("tasks", "important", nullable=False)
    op.alter_column("tasks", "urgent", nullable=False)
    op.execute(
        """UPDATE proposals SET payload =
        (payload - 'importance' - 'urgency') ||
        jsonb_build_object(
            'important', COALESCE((payload->>'importance')::numeric >= 6, false),
            'urgent', COALESCE((payload->>'urgency')::numeric >= 6, false)
        ) WHERE operation = 'create'"""
    )
    op.execute(
        """UPDATE proposals SET payload =
        (payload - 'importance' - 'urgency') ||
        CASE WHEN payload ? 'importance' THEN
            jsonb_build_object('important', (payload->>'importance')::numeric >= 6)
        ELSE '{}'::jsonb END ||
        CASE WHEN payload ? 'urgency' THEN
            jsonb_build_object('urgent', (payload->>'urgency')::numeric >= 6)
        ELSE '{}'::jsonb END
        WHERE operation = 'update'"""
    )
    op.execute(
        """UPDATE proposals SET receipt = jsonb_set(receipt, '{task}',
        ((receipt->'task') - 'importance' - 'urgency') ||
        jsonb_build_object(
            'important', COALESCE((receipt->'task'->>'importance')::numeric >= 6, false),
            'urgent', COALESCE((receipt->'task'->>'urgency')::numeric >= 6, false)
        )) WHERE jsonb_typeof(receipt->'task') = 'object'"""
    )
    op.drop_constraint("ck_tasks_importance_score", "tasks")
    op.drop_constraint("ck_tasks_urgency_score", "tasks")
    op.drop_column("tasks", "importance")
    op.drop_column("tasks", "urgency")
