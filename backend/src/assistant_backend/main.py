from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from assistant_backend.application.identity import AuthFailure, IdentityService
from assistant_backend.application.agent_runs import AgentRunService, RunFailure
from assistant_backend.application.conversations import ConversationFailure, ConversationService
from assistant_backend.application.tasks import TaskFailure, TaskService
from assistant_backend.application.reports import ReportService
from assistant_backend.agent.provider import ChatCompletionClient, ChatReportAnalyzer
from assistant_backend.application.speech import SpeechFailure, SpeechService
from assistant_backend.config import Settings
from assistant_backend.infrastructure.database import make_engine, make_session_factory
from assistant_backend.presentation.auth import router as auth_router
from assistant_backend.presentation.agent import router as agent_router
from assistant_backend.presentation.conversations import router as conversations_router
from assistant_backend.presentation.errors import ErrorResponse
from assistant_backend.presentation.tasks import router as tasks_router
from assistant_backend.presentation.speech import router as speech_router


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings()
    engine = make_engine(settings)
    factory = make_session_factory(engine)
    app = FastAPI(title="拾序 Backend API", version="0.3.0")
    app.state.settings = settings
    app.state.identity_service = IdentityService(factory, settings)
    app.state.task_service = TaskService(factory)
    app.state.report_service = ReportService(
        factory, ChatReportAnalyzer(ChatCompletionClient(*settings.chat_provider))
    )
    app.state.conversation_service = ConversationService(factory)
    app.state.agent_run_service = AgentRunService(factory, settings)
    app.state.speech_service = SpeechService(factory, settings)

    @app.middleware("http")
    async def request_id_middleware(request: Request, call_next):  # type: ignore[no-untyped-def]
        request.state.request_id = str(uuid4())
        response = await call_next(request)
        response.headers["X-Request-ID"] = request.state.request_id
        return response

    def error_response(request: Request, code: str, message: str, status: int) -> JSONResponse:
        body = ErrorResponse(
            code=code,
            message=message,
            request_id=request.state.request_id,
            retryable=status >= 500 or status == 429,
        )
        return JSONResponse(
            status_code=status,
            content=body.model_dump(exclude_none=True),
            headers={"X-Request-ID": request.state.request_id},
        )

    @app.exception_handler(AuthFailure)
    async def auth_error(request: Request, exc: AuthFailure) -> JSONResponse:
        return error_response(request, exc.code, exc.message, exc.status)

    @app.exception_handler(TaskFailure)
    async def task_error(request: Request, exc: TaskFailure) -> JSONResponse:
        return error_response(request, exc.code, exc.message, exc.status)

    @app.exception_handler(ConversationFailure)
    async def conversation_error(request: Request, exc: ConversationFailure) -> JSONResponse:
        return error_response(request, exc.code, exc.message, exc.status)

    @app.exception_handler(RunFailure)
    async def run_error(request: Request, exc: RunFailure) -> JSONResponse:
        return error_response(request, exc.code, exc.message, exc.status)

    @app.exception_handler(SpeechFailure)
    async def speech_error(request: Request, exc: SpeechFailure) -> JSONResponse:
        return error_response(request, exc.code, exc.message, exc.status)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        del exc
        return error_response(request, "INVALID_REQUEST", "Invalid request", 422)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = "NOT_FOUND" if exc.status_code == 404 else "HTTP_ERROR"
        return error_response(request, code, "Request failed", exc.status_code)

    @app.exception_handler(Exception)
    async def unhandled_error(request: Request, exc: Exception) -> JSONResponse:
        del exc
        return error_response(request, "INTERNAL_ERROR", "Internal server error", 500)

    @app.get("/healthz", tags=["system"], response_model=dict[str, str])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(auth_router)
    app.include_router(tasks_router)
    app.include_router(conversations_router)
    app.include_router(agent_router)
    app.include_router(speech_router)
    return app


app = create_app()
