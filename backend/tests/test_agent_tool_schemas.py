from assistant_backend.agent.tools import TASK_TOOLS
from assistant_backend.agent.tools import ProposalTaskTools
from types import SimpleNamespace
import json


def test_optional_tool_arguments_are_omitted_instead_of_sent_as_null() -> None:
    functions = {tool["function"]["name"]: tool["function"] for tool in TASK_TOOLS}
    search = functions["search_tasks"]
    assert search["parameters"]["required"] == []
    assert search["parameters"]["properties"]["keyword"]["type"] == "string"
    assert search["parameters"]["properties"]["status"]["enum"] == ["open", "completed"]

    create_task = functions["propose_create_task"]["parameters"]["properties"]["task"]
    properties = create_task["properties"]
    assert properties["description"]["type"] == "string"
    assert properties["category"]["type"] == "string"
    assert all(option.get("type") != "null" for option in properties["due"]["anyOf"])

    update = functions["propose_update_task"]["parameters"]["properties"]
    assert update["clear_fields"]["items"]["enum"] == ["description", "category", "due"]


def test_update_tool_converts_clear_fields_into_null_patch_values() -> None:
    class Tasks:
        proposal = None

        def create_proposal(self, user_id, body, source):
            self.proposal = body
            return SimpleNamespace(
                proposal_id="11111111-1111-4111-8111-111111111111",
                operation="update",
                task_id=body.task_id,
                status="pending",
                expires_at="2026-10-04T00:00:00Z",
            )

    tasks = Tasks()
    result = ProposalTaskTools(tasks, "user-1", "run-1").invoke(
        "propose_update_task",
        json.dumps(
            {
                "task_id": "22222222-2222-4222-8222-222222222222",
                "expected_version": 1,
                "changes": {"title": "准备新展示"},
                "clear_fields": ["description", "category", "due"],
            }
        ),
        "call-1",
    )
    assert json.loads(result)["status"] == "pending"
    assert tasks.proposal.changes.model_fields_set == {"title", "description", "category", "due"}
    assert tasks.proposal.changes.description is None
    assert tasks.proposal.changes.category is None
    assert tasks.proposal.changes.due is None


def test_update_tool_rejects_non_object_changes() -> None:
    result = ProposalTaskTools(SimpleNamespace(), "user-1", "run-1").invoke(
        "propose_update_task",
        json.dumps({"task_id": "task-1", "expected_version": 1, "changes": None}),
        "call-1",
    )
    assert json.loads(result) == {"error": "invalid_arguments"}
