def clean_conversation_title(value: str) -> str:
    title = value.strip()
    if not title:
        raise ValueError("Title cannot be empty")
    if len(title) > 200:
        raise ValueError("Title cannot exceed 200 characters")
    return title


def title_from_first_message(content: str) -> str:
    normalized = " ".join(content.split())
    return normalized[:24] + ("…" if len(normalized) > 24 else "")
