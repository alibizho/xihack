"""Name existing default conversations from their first user message."""

from alembic import op


revision = "0006_conversation_titles"
down_revision = "0005_agent_runs_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        WITH first_message AS (
            SELECT DISTINCT ON (conversation_id)
                conversation_id,
                btrim(regexp_replace(content, '[[:space:]]+', ' ', 'g')) AS text
            FROM messages
            WHERE role = 'user'
            ORDER BY conversation_id, created_at, message_id
        )
        UPDATE conversations AS conversation
        SET title = CASE
            WHEN char_length(first_message.text) > 24
                THEN left(first_message.text, 24) || '…'
            ELSE first_message.text
        END
        FROM first_message
        WHERE conversation.conversation_id = first_message.conversation_id
          AND conversation.title = '新对话'
          AND first_message.text <> ''
        """
    )


def downgrade() -> None:
    # The original placeholder cannot be distinguished from a user title after migration.
    pass
