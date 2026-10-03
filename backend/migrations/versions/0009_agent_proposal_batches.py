"""Persist Agent proposal batches for atomic review and confirmation."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "0009_agent_proposal_batches"
down_revision = "0008_numeric_task_scores"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "proposal_batches",
        sa.Column("batch_id", sa.String(length=36), primary_key=True),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("client_request_id", sa.String(length=128), nullable=False),
        sa.Column("request_fingerprint", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("confirm_key_hash", sa.String(length=64)),
        sa.Column("receipt", postgresql.JSONB(astext_type=sa.Text())),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "status IN ('pending', 'confirmed', 'cancelled')",
            name="ck_proposal_batches_status",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.user_id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.run_id"], ondelete="CASCADE"),
        sa.UniqueConstraint("user_id", "client_request_id", name="uq_proposal_batches_request"),
    )
    op.create_index(
        "ix_proposal_batches_user_created", "proposal_batches", ["user_id", "created_at"]
    )
    op.create_index("ix_proposal_batches_run", "proposal_batches", ["run_id"])
    op.add_column("proposals", sa.Column("batch_id", sa.String(length=36)))
    op.create_foreign_key(
        "fk_proposals_batch_id_proposal_batches",
        "proposals",
        "proposal_batches",
        ["batch_id"],
        ["batch_id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_proposals_batch_created", "proposals", ["batch_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_proposals_batch_created", table_name="proposals")
    op.drop_constraint("fk_proposals_batch_id_proposal_batches", "proposals", type_="foreignkey")
    op.drop_column("proposals", "batch_id")
    op.drop_index("ix_proposal_batches_run", table_name="proposal_batches")
    op.drop_index("ix_proposal_batches_user_created", table_name="proposal_batches")
    op.drop_table("proposal_batches")
