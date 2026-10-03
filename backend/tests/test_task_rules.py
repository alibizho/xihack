from datetime import datetime

import pytest
from pydantic import ValidationError

from assistant_backend.domain.tasks import require_version
from assistant_backend.presentation.schemas import (
    DateDue,
    MinuteDue,
    ProposalCreateRequest,
    TaskPatch,
)


def test_date_precision_keeps_local_date_and_zone() -> None:
    due = DateDue(precision="date", date="2026-10-09", timezone="Asia/Shanghai")
    assert due.model_dump(mode="json") == {
        "precision": "date",
        "date": "2026-10-09",
        "timezone": "Asia/Shanghai",
    }


def test_minute_precision_requires_matching_offset_and_no_seconds() -> None:
    due = MinuteDue(
        precision="minute",
        at="2026-10-09T15:30:00+08:00",
        timezone="Asia/Shanghai",
    )
    assert isinstance(due.at, datetime)
    with pytest.raises(ValidationError):
        MinuteDue(precision="minute", at="2026-10-09T15:30:00Z", timezone="Asia/Shanghai")
    with pytest.raises(ValidationError):
        MinuteDue(
            precision="minute",
            at="2026-10-09T15:30:01+08:00",
            timezone="Asia/Shanghai",
        )


def test_update_patch_distinguishes_clear_from_omitted() -> None:
    patch = TaskPatch(description=None)
    assert patch.model_dump(exclude_unset=True) == {"description": None}
    with pytest.raises(ValidationError):
        TaskPatch()
    with pytest.raises(ValidationError):
        TaskPatch(title=None)


def test_proposal_operation_requires_appropriate_payload() -> None:
    with pytest.raises(ValidationError):
        ProposalCreateRequest(client_request_id="a", operation="create")
    with pytest.raises(ValidationError):
        ProposalCreateRequest(
            client_request_id="b",
            operation="delete",
            task_id="task-1",
            expected_version=1,
            changes={"title": "Unexpected"},
        )


def test_version_conflict_is_explicit() -> None:
    require_version(2, 2)
    with pytest.raises(ValueError, match="version conflict"):
        require_version(3, 2)
