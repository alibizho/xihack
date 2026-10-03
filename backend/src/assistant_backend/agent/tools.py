import json
from datetime import date
from typing import Any, Annotated, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from assistant_backend.application.tasks import TaskFailure, TaskService
from assistant_backend.application.training import TrainingSummaryService
from assistant_backend.presentation.schemas import (
    ProposalCreateRequest,
    ProposalOperation,
    TaskCreate,
    TaskPatch,
)


class SearchTaskArguments(BaseModel):
    model_config = ConfigDict(extra="forbid")

    keyword: str | None = Field(default=None, max_length=200)
    due_from: date | None = None
    due_to: date | None = None
    important: bool | None = None
    urgent: bool | None = None
    status: Literal["open", "completed"] | None = None
    category: str | None = Field(default=None, max_length=64)
    limit: int = Field(default=10, ge=1, le=10)


class GetTaskArguments(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: str = Field(min_length=1, max_length=36)


class SearchReportArguments(BaseModel):
    model_config = ConfigDict(extra="forbid")

    limit: int = Field(default=10, ge=1, le=10)


class TrainingSummaryArguments(BaseModel):
    model_config = ConfigDict(extra="forbid")

    day_period: Literal["morning", "afternoon", "evening", "night"]


class FinishTurnArguments(BaseModel):
    model_config = ConfigDict(extra="forbid")

    result_type: Literal["message", "task_query", "advice", "clarification", "proposal_bundle"]
    message: str = Field(min_length=1, max_length=1200)
    task_refs: list[Annotated[str, Field(min_length=1, max_length=36)]] = Field(default_factory=list, max_length=10)
    recommended_task_id: str = Field(default="", max_length=36)
    suggested_prompts: list[Annotated[str, Field(min_length=1, max_length=120)]] = Field(default_factory=list, max_length=3)


READ_ONLY_TASK_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_training_summary",
            "description": "Read compact, account-owned focus training metrics only when planning/advising. Never use them for simple task creation or ordinary task queries. Training is a low-priority tie-breaker, not a capability or health assessment.",
            "parameters": {
                "type": "object",
                "properties": {"day_period": {"type": "string", "enum": ["morning", "afternoon", "evening", "night"]}},
                "required": ["day_period"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_task_reports",
            "description": "Read recent completed-task report insights for this user. Use when recommending or dividing future work.",
            "parameters": {
                "type": "object",
                "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 10}},
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_tasks",
            "description": "Read tasks belonging to the authenticated user, with optional filters.",
            "strict": False,
            "parameters": {
                "type": "object",
                "properties": {
                    "keyword": {"type": "string", "maxLength": 200},
                    "due_from": {"type": "string", "format": "date"},
                    "due_to": {"type": "string", "format": "date"},
                    "important": {"type": "boolean"},
                    "urgent": {"type": "boolean"},
                    "status": {"type": "string", "enum": ["open", "completed"]},
                    "category": {"type": "string", "maxLength": 64},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 10},
                },
                "required": [],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_task",
            "description": "Read one task owned by the authenticated user.",
            "strict": True,
            "parameters": {
                "type": "object",
                "properties": {"task_id": {"type": "string", "minLength": 1, "maxLength": 36}},
                "required": ["task_id"],
                "additionalProperties": False,
            },
        },
    },
]

FINAL_RESULT_TOOL = {
    "type": "function",
    "function": {
        "name": "finish_turn",
        "description": "Finish the user-facing turn. Provide a brief natural message, accurate result type, up to ten task IDs from this run's search_tasks/get_task tool results, the recommended ID if any, and up to three next-step prompts in the current UI language. Never invent a task ID. Use empty string when there is no recommendation.",
        "parameters": {
            "type": "object",
            "properties": {
                "result_type": {"type": "string", "enum": ["message", "task_query", "advice", "clarification", "proposal_bundle"]},
                "message": {"type": "string", "minLength": 1, "maxLength": 1200},
                "task_refs": {"type": "array", "items": {"type": "string", "minLength": 1, "maxLength": 36}, "maxItems": 10},
                "recommended_task_id": {"type": "string", "maxLength": 36},
                "suggested_prompts": {"type": "array", "items": {"type": "string", "minLength": 1, "maxLength": 120}, "maxItems": 3},
            },
            "required": ["result_type", "message", "task_refs", "recommended_task_id", "suggested_prompts"],
            "additionalProperties": False,
        },
    },
}


def _due_schema() -> dict[str, Any]:
    return {
        "anyOf": [
            {
                "type": "object",
                "properties": {
                    "precision": {"const": "date"},
                    "date": {"type": "string", "format": "date"},
                    "timezone": {"type": "string"},
                },
                "required": ["precision", "date", "timezone"],
                "additionalProperties": False,
            },
            {
                "type": "object",
                "properties": {
                    "precision": {"const": "minute"},
                    "at": {"type": "string", "format": "date-time"},
                    "timezone": {"type": "string"},
                },
                "required": ["precision", "at", "timezone"],
                "additionalProperties": False,
            },
        ]
    }


def _task_properties() -> dict[str, Any]:
    return {
        "title": {"type": "string", "minLength": 1, "maxLength": 200},
        "description": {"type": "string", "maxLength": 2000},
        "category": {"type": "string", "maxLength": 64},
        "due": _due_schema(),
        "importance": {
            "type": "number",
            "minimum": 0,
            "maximum": 10,
            "description": "Importance score from 0 to 10 in steps of 0.1; impact matters more than deadline.",
        },
        "urgency": {
            "type": "number",
            "minimum": 0,
            "maximum": 10,
            "description": "Urgency score from 0 to 10 in steps of 0.1; use deadline and time pressure.",
        },
    }


def _proposal_tool(name: str, description: str, properties: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": description,
            "strict": False,
            "parameters": {
                "type": "object",
                "properties": properties,
                "additionalProperties": False,
            },
        },
    }


PROPOSAL_TOOLS = [
    _proposal_tool(
        "propose_create_tasks",
        "Save one batch of 1 to 10 interpreted task proposals. Use exactly one call for a multi-task request. Every item must include a concise title, category, importance, and urgency; include due only when supported by the user's words. Do not guess missing key actions or objects. The batch remains pending until the user reviews and confirms it.",
        {
            "tasks": {
                "type": "array",
                "minItems": 1,
                "maxItems": 10,
                "items": {
                    "type": "object",
                    "properties": _task_properties()
                    | {"category": {"type": "string", "minLength": 1, "maxLength": 64}},
                    "required": ["title", "category", "importance", "urgency"],
                    "additionalProperties": False,
                },
            }
        },
    ),
    _proposal_tool(
        "propose_create_task",
        "Save an interpreted task proposal, with a short action title, inferred category and scores, and a due date/time or null. Never copy the whole utterance into the title. The user must confirm it.",
        {
            "task": {
                "type": "object",
                "properties": _task_properties()
                | {"category": {"type": "string", "minLength": 1, "maxLength": 64}},
                "required": ["title", "category", "importance", "urgency"],
                "additionalProperties": False,
            }
        },
    ),
    _proposal_tool(
        "propose_update_task",
        "Save a task update proposal. The user must confirm it before any task is changed.",
        {
            "task_id": {"type": "string", "minLength": 1, "maxLength": 36},
            "expected_version": {"type": "integer", "minimum": 1},
            "changes": {"type": "object", "properties": _task_properties(), "required": []},
        },
    ),
    _proposal_tool(
        "propose_complete_task",
        "Save a task completion proposal. The user must confirm it before completion.",
        {
            "task_id": {"type": "string", "minLength": 1, "maxLength": 36},
            "expected_version": {"type": "integer", "minimum": 1},
        },
    ),
    _proposal_tool(
        "propose_delete_task",
        "Save a task deletion proposal. The user must confirm it before deletion.",
        {
            "task_id": {"type": "string", "minLength": 1, "maxLength": 36},
            "expected_version": {"type": "integer", "minimum": 1},
        },
    ),
]

TASK_TOOLS = [*READ_ONLY_TASK_TOOLS, *PROPOSAL_TOOLS, FINAL_RESULT_TOOL]


class ReadOnlyTaskTools:
    def __init__(self, service: TaskService, user_id: str, training: TrainingSummaryService | None = None) -> None:
        self.service = service
        self.user_id = user_id
        self.training = training

    def invoke(self, name: str, raw_arguments: str) -> str:
        try:
            if name == "get_training_summary":
                args = TrainingSummaryArguments.model_validate_json(raw_arguments)
                summary = self.training.recent(self.user_id, args.day_period) if self.training else {"available": False, "sample_count": 0, "trend": "insufficient_data"}
                return json.dumps(summary, ensure_ascii=False)
            if name == "search_task_reports":
                args = SearchReportArguments.model_validate_json(raw_arguments)
                return json.dumps(
                    self.service.report_insights(self.user_id, args.limit), ensure_ascii=False
                )
            if name == "search_tasks":
                args = SearchTaskArguments.model_validate_json(raw_arguments)
                result = self.service.list(
                    self.user_id,
                    keyword=args.keyword,
                    due_from=args.due_from,
                    due_to=args.due_to,
                    important=args.important,
                    urgent=args.urgent,
                    status=args.status,
                    category=args.category,
                    limit=min(args.limit, 10),
                )
                return json.dumps(
                    {
                        "items": [self._agent_task(item.model_dump(mode="json")) for item in result.items],
                        "has_more": result.next_cursor is not None,
                    },
                    ensure_ascii=False,
                )
            if name == "get_task":
                args = GetTaskArguments.model_validate_json(raw_arguments)
                result = self.service.get(self.user_id, args.task_id)
                return json.dumps(self._agent_task(result.model_dump(mode="json")), ensure_ascii=False)
            return json.dumps({"error": "unknown_tool"})
        except ValidationError:
            return json.dumps({"error": "invalid_arguments"})
        except TaskFailure as exc:
            return json.dumps({"error": exc.code.lower()})

    @staticmethod
    def _agent_task(task: dict) -> dict:
        description = task.get("description")
        return {
            "task_id": task["task_id"],
            "title": task["title"],
            "description": description[:400] if isinstance(description, str) else None,
            "category": task.get("category"),
            "due": task.get("due"),
            "importance": task["importance"],
            "urgency": task["urgency"],
            "status": task["status"],
            "version": task["version"],
        }


class ProposalTaskTools:
    def __init__(self, service: TaskService, user_id: str, run_id: str) -> None:
        self.service = service
        self.user_id = user_id
        self.run_id = run_id

    def invoke(self, name: str, raw_arguments: str, call_id: str) -> str:
        try:
            raw = json.loads(raw_arguments)
            if not isinstance(raw, dict):
                return json.dumps({"error": "invalid_arguments"})
            if name == "propose_create_task":
                task_fields = raw.get("task")
                required = {"title", "category", "importance", "urgency"}
                if not isinstance(task_fields, dict) or not required <= task_fields.keys():
                    return json.dumps(
                        {
                            "error": "incomplete_task",
                            "hint": "Provide a concise title, inferred category, importance and urgency; include a due date/time when stated.",
                        }
                    )
                task = TaskCreate.model_validate(task_fields)
                if not task.category:
                    return json.dumps({"error": "incomplete_task", "hint": "Infer a category."})
                body = ProposalCreateRequest(
                    client_request_id=self._request_id(call_id),
                    operation=ProposalOperation.CREATE,
                    task=task,
                )
            elif name == "propose_create_tasks":
                if set(raw) != {"tasks"} or not isinstance(raw["tasks"], list):
                    return json.dumps({"error": "invalid_arguments"})
                if not 1 <= len(raw["tasks"]) <= 10:
                    return json.dumps(
                        {"error": "invalid_batch_size", "maximum": 10}, ensure_ascii=False
                    )
                required = {"title", "category", "importance", "urgency"}
                if any(
                    not isinstance(item, dict) or not required <= item.keys()
                    for item in raw["tasks"]
                ):
                    return json.dumps({"error": "incomplete_task_item"})
                tasks = [TaskCreate.model_validate(item) for item in raw["tasks"]]
                if any(not task.category for task in tasks):
                    return json.dumps({"error": "incomplete_task_item"})
                batch = self.service.create_agent_proposal_batch(
                    self.user_id, self.run_id, call_id, tasks
                )
                return json.dumps(
                    {
                        "batch_id": batch.batch_id,
                        "status": batch.status,
                        "pending_count": sum(
                            proposal.status == "pending" for proposal in batch.proposals
                        ),
                        "proposal_ids": [proposal.proposal_id for proposal in batch.proposals],
                    },
                    ensure_ascii=False,
                )
            elif name == "propose_update_task":
                body = ProposalCreateRequest(
                    client_request_id=self._request_id(call_id),
                    operation=ProposalOperation.UPDATE,
                    task_id=raw["task_id"],
                    expected_version=raw["expected_version"],
                    changes=TaskPatch.model_validate(raw["changes"]),
                )
            elif name in {"propose_complete_task", "propose_delete_task"}:
                body = ProposalCreateRequest(
                    client_request_id=self._request_id(call_id),
                    operation=(
                        ProposalOperation.COMPLETE
                        if name == "propose_complete_task"
                        else ProposalOperation.DELETE
                    ),
                    task_id=raw["task_id"],
                    expected_version=raw["expected_version"],
                )
            else:
                return json.dumps({"error": "unknown_tool"})
            result = self.service.create_proposal(self.user_id, body, source="agent")
            return json.dumps(
                {
                    "proposal_id": result.proposal_id,
                    "operation": result.operation,
                    "task_id": result.task_id,
                    "status": result.status,
                    "expires_at": result.expires_at,
                },
                ensure_ascii=False,
                default=str,
            )
        except (KeyError, TypeError, ValueError, ValidationError):
            return json.dumps({"error": "invalid_arguments"})
        except TaskFailure as exc:
            return json.dumps({"error": exc.code.lower()})

    def _request_id(self, call_id: str) -> str:
        suffix = call_id or str(uuid4())
        return f"agent:{self.run_id}:{suffix}"[:128]
