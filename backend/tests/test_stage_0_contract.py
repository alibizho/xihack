import json
from pathlib import Path

from assistant_backend.main import create_app
from assistant_backend.presentation.schemas import ProposalConfirmationRequest, TaskResponse


ROOT = Path(__file__).parents[1]


def test_health_endpoint_is_available() -> None:
    route_paths = {route.path for route in create_app().routes}
    assert "/healthz" in route_paths


def test_task_dto_has_no_identity_field() -> None:
    assert "user_id" not in TaskResponse.model_fields


def test_confirmation_requires_idempotency_key() -> None:
    assert ProposalConfirmationRequest.model_json_schema()["required"] == ["idempotency_key"]


def test_contract_exposes_no_direct_task_write_route() -> None:
    contract = json.loads((ROOT / "contracts/openapi.json").read_text(encoding="utf-8"))
    app_paths = create_app().openapi()["paths"]
    assert contract["paths"] == app_paths
    task_paths = [path for path in contract["paths"] if path.startswith("/api/tasks")]
    assert all(set(contract["paths"][path]) <= {"get"} for path in task_paths)
    assert "/api/auth/register" in contract["paths"]


def test_agent_proposals_have_a_conversation_scoped_read_route() -> None:
    assert "/api/conversations/{conversation_id}/proposal-ids" in create_app().openapi()["paths"]
