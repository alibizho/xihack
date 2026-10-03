from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


def clean_title(value: str) -> str:
    title = value.strip()
    if not 1 <= len(title) <= 200:
        raise ValueError("Title must contain 1–200 characters")
    return title


def clean_optional_text(value: str | None, maximum: int) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    if len(cleaned) > maximum:
        raise ValueError(f"Text must contain at most {maximum} characters")
    return cleaned or None


def validate_timezone(value: str) -> str:
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError("Timezone must be a valid IANA name") from exc
    return value


def validate_minute_due(value: datetime, timezone_name: str) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Minute deadline must include a UTC offset")
    if value.second or value.microsecond:
        raise ValueError("Minute deadline cannot include seconds")
    zone = ZoneInfo(validate_timezone(timezone_name))
    if value.utcoffset() != value.astimezone(zone).utcoffset():
        raise ValueError("Deadline offset does not match timezone")
    return value


def require_version(current: int, expected: int) -> None:
    if current != expected:
        raise ValueError("Task version conflict")
