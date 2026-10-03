from typing import Annotated

from fastapi import APIRouter, Depends, Header, Request, Response
from pydantic import BaseModel, ConfigDict, Field, StrictBool

from assistant_backend.application.identity import AuthFailure, IdentityService, SessionIdentity
from assistant_backend.config import Settings
from assistant_backend.presentation.errors import ErrorResponse


router = APIRouter(
    prefix="/api/auth",
    tags=["auth"],
    responses={
        401: {"model": ErrorResponse},
        403: {"model": ErrorResponse},
        422: {"model": ErrorResponse},
        429: {"model": ErrorResponse},
    },
)


class Credentials(BaseModel):
    model_config = ConfigDict(extra="forbid")

    username: str = Field(pattern=r"^[A-Za-z0-9_]{3,32}$")
    password: str = Field(min_length=15, max_length=128)


class Registration(Credentials):
    adult_declared: StrictBool = Field(description="The registrant confirms they are at least 18.")


class PublicUser(BaseModel):
    username: str


class AuthResponse(BaseModel):
    user: PublicUser


class CsrfResponse(BaseModel):
    csrf_token: str


def get_service(request: Request) -> IdentityService:
    return request.app.state.identity_service


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def require_origin(request: Request, settings: Annotated[Settings, Depends(get_settings)]) -> None:
    if request.headers.get("origin") != settings.app_origin:
        raise AuthFailure("ORIGIN_INVALID", 403, "Request origin invalid")


def get_identity(
    request: Request,
    service: Annotated[IdentityService, Depends(get_service)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> SessionIdentity:
    return service.current(request.cookies.get(settings.session_cookie_name))


def require_csrf(
    request: Request,
    service: Annotated[IdentityService, Depends(get_service)],
    settings: Annotated[Settings, Depends(get_settings)],
    csrf_header: Annotated[str | None, Header(alias="X-CSRF-Token")] = None,
) -> None:
    service.verify_csrf(request.cookies.get(settings.session_cookie_name, ""), csrf_header)


def set_session_cookie(response: Response, token: str, settings: Settings) -> None:
    response.set_cookie(
        settings.session_cookie_name,
        token,
        httponly=True,
        secure=settings.app_env != "development",
        samesite="strict",
        path="/",
    )


@router.post(
    "/register",
    response_model=AuthResponse,
    status_code=201,
    dependencies=[Depends(require_origin)],
)
def register(
    body: Registration,
    request: Request,
    response: Response,
    service: Annotated[IdentityService, Depends(get_service)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> AuthResponse:
    ip = request.client.host if request.client else "unknown"
    result = service.register(
        body.username,
        body.password,
        body.adult_declared,
        ip,
        request.cookies.get(settings.session_cookie_name),
    )
    set_session_cookie(response, result.token, settings)
    return AuthResponse(user=PublicUser(username=result.username))


@router.post("/login", response_model=AuthResponse, dependencies=[Depends(require_origin)])
def login(
    body: Credentials,
    request: Request,
    response: Response,
    service: Annotated[IdentityService, Depends(get_service)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> AuthResponse:
    ip = request.client.host if request.client else "unknown"
    result = service.login(
        body.username, body.password, ip, request.cookies.get(settings.session_cookie_name)
    )
    set_session_cookie(response, result.token, settings)
    return AuthResponse(user=PublicUser(username=result.username))


@router.get("/me", response_model=AuthResponse)
def me(identity: Annotated[SessionIdentity, Depends(get_identity)]) -> AuthResponse:
    return AuthResponse(user=PublicUser(username=identity.username))


@router.get("/csrf", response_model=CsrfResponse)
def csrf(
    request: Request,
    response: Response,
    identity: Annotated[SessionIdentity, Depends(get_identity)],
    service: Annotated[IdentityService, Depends(get_service)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> CsrfResponse:
    del identity
    response.headers["Cache-Control"] = "no-store"
    token = request.cookies[settings.session_cookie_name]
    return CsrfResponse(csrf_token=service.csrf_token(token))


@router.post("/logout", status_code=204, dependencies=[Depends(require_origin)])
def logout(
    request: Request,
    response: Response,
    identity: Annotated[SessionIdentity, Depends(get_identity)],
    service: Annotated[IdentityService, Depends(get_service)],
    settings: Annotated[Settings, Depends(get_settings)],
    csrf_header: Annotated[str | None, Header(alias="X-CSRF-Token")] = None,
) -> None:
    token = request.cookies[settings.session_cookie_name]
    service.verify_csrf(token, csrf_header)
    service.logout(identity)
    response.delete_cookie(settings.session_cookie_name, path="/")
