def clean_conversation_title(value: str) -> str:
    title = value.strip()
    if not title:
        raise ValueError("Title cannot be empty")
    if len(title) > 200:
        raise ValueError("Title cannot exceed 200 characters")
    return title
