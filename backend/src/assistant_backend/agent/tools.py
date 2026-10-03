import json
from datetime import date
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from assistant_backend.application.tasks import TaskFailure, TaskService
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
    limit: int = Field(default=20, ge=1, le=20)


class GetTaskArguments(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: str = Field(min_length=1, max_length=36)


class SearchReportArguments(BaseModel):
    model_config = ConfigDict(extra="forbid")

    limit: int = Field(default=10, ge=1, le=10)


READ_ONLY_TASK_TOOLS = [
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
                    "limit": {"type": "integer", "minimum": 1, "maximum": 20},
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

TASK_TOOLS = [*READ_ONLY_TASK_TOOLS, *PROPOSAL_TOOLS]


class ReadOnlyTaskTools:
    def __init__(self, service: TaskService, user_id: str) -> None:
        self.service = service
        self.user_id = user_id

    def invoke(self, name: str, raw_arguments: str) -> str:
        try:
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
                    limit=args.limit,
                )
                return json.dumps(result.model_dump(mode="json"), ensure_ascii=False)
            if name == "get_task":
                args = GetTaskArguments.model_validate_json(raw_arguments)
                result = self.service.get(self.user_id, args.task_id)
                return json.dumps(result.model_dump(mode="json"), ensure_ascii=False)
            return json.dumps({"error": "unknown_tool"})
        except ValidationError:
            return json.dumps({"error": "invalid_arguments"})
        except TaskFailure as exc:
            return json.dumps({"error": exc.code.lower()})


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
