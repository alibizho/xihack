import os
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from assistant_backend.config import Settings
from assistant_backend.main import create_app


DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
PASSWORD = "a long test passphrase 123"
ORIGIN = "https://test.example"


@pytest.fixture
def client() -> Iterator[TestClient]:
    if DATABASE_URL is None:
        pytest.skip("TEST_DATABASE_URL is required")
    if not (make_url(DATABASE_URL).database or "").endswith("_test"):
        pytest.fail("TEST_DATABASE_URL must point to a dedicated *_test database")
    engine = create_engine(DATABASE_URL)
    with engine.begin() as connection:
        connection.execute(
            text("TRUNCATE auth_rate_limits, sessions, users RESTART IDENTITY CASCADE")
        )
    engine.dispose()
    settings = Settings(
        _env_file=None,
        database_url=DATABASE_URL,
        app_origin=ORIGIN,
        csrf_secret="test-secret-with-at-least-32-characters",
    )
    with TestClient(create_app(settings), base_url=ORIGIN) as test_client:
        yield test_client


def register(client: TestClient, username: str = "Sample_User") -> None:
    response = client.post(
        "/api/auth/register",
        json={"username": username, "password": PASSWORD, "adult_declared": True},
        headers={"Origin": ORIGIN},
    )
    assert response.status_code == 201, response.text
    assert response.json() == {"user": {"username": username}}
    assert "httponly" in response.headers["set-cookie"].lower()


def test_register_login_multi_device_and_logout(client: TestClient) -> None:
    assert client.get("/api/auth/me").status_code == 401
    register(client)
    first_token = client.cookies["shixu_session"]
    assert client.get("/api/auth/me").json() == {"user": {"username": "Sample_User"}}
    csrf_response = client.get("/api/auth/csrf")
    assert csrf_response.headers["Cache-Control"] == "no-store"
    assert client.post("/api/auth/logout", headers={"Origin": ORIGIN}).status_code == 403

    with TestClient(client.app, base_url=ORIGIN) as second_device:
        login = second_device.post(
            "/api/auth/login",
            json={"username": "sample_user", "password": PASSWORD},
            headers={"Origin": ORIGIN},
        )
        assert login.status_code == 200
        assert second_device.get("/api/auth/me").status_code == 200

        rotated = client.post(
            "/api/auth/login",
            json={"username": "Sample_User", "password": PASSWORD},
            headers={"Origin": ORIGIN},
        )
        assert rotated.status_code == 200
        with TestClient(client.app, base_url=ORIGIN) as old_session:
            old_session.cookies.set("shixu_session", first_token)
            assert old_session.get("/api/auth/me").status_code == 401
        csrf_token = client.get("/api/auth/csrf").json()["csrf_token"]

        logout = client.post(
            "/api/auth/logout",
            headers={"Origin": ORIGIN, "X-CSRF-Token": csrf_token},
        )
        assert logout.status_code == 204
        assert client.get("/api/auth/me").status_code == 401
        assert second_device.get("/api/auth/me").status_code == 200


def test_each_account_is_resolved_from_its_own_cookie(client: TestClient) -> None:
    register(client, "First_User")
    with TestClient(client.app, base_url=ORIGIN) as second_account:
        register(second_account, "Second_User")
        assert client.get("/api/auth/me").json()["user"]["username"] == "First_User"
        assert second_account.get("/api/auth/me").json()["user"]["username"] == "Second_User"


def test_password_and_cookie_are_not_stored_as_plaintext(client: TestClient) -> None:
    register(client)
    assert DATABASE_URL is not None
    engine = create_engine(DATABASE_URL)
    with engine.connect() as connection:
        password_hash = connection.scalar(text("SELECT password_hash FROM users"))
        token_hash = connection.scalar(text("SELECT token_hash FROM sessions"))
    engine.dispose()
    assert password_hash.startswith("$argon2id$")
    assert PASSWORD not in password_hash
    assert token_hash != client.cookies["shixu_session"]


def test_production_settings_require_https_host_cookie_and_secret() -> None:
    with pytest.raises(ValueError):
        Settings(_env_file=None, app_env="production")
    production = Settings(
        _env_file=None,
        app_env="production",
        app_origin="https://example.com",
        session_cookie_name="__Host-shixu_session",
        csrf_secret="unique-production-test-secret-at-least-32-characters",
    )
    assert production.app_env == "production"


def test_registration_and_login_errors_do_not_disclose_secrets(client: TestClient) -> None:
    rejected = client.post(
        "/api/auth/register",
        json={"username": "user_123", "password": PASSWORD, "adult_declared": False},
        headers={"Origin": ORIGIN},
    )
    assert rejected.status_code == 422
    assert client.get("/api/auth/me").status_code == 401
    register(client)
    duplicate = client.post(
        "/api/auth/register",
        json={"username": "sample_user", "password": PASSWORD, "adult_declared": True},
        headers={"Origin": ORIGIN},
    )
    assert duplicate.status_code == 409
    unknown = client.post(
        "/api/auth/login",
        json={"username": "missing_user", "password": PASSWORD},
        headers={"Origin": ORIGIN},
    )
    bad_password = client.post(
        "/api/auth/login",
        json={"username": "sample_user", "password": "incorrect password 123"},
        headers={"Origin": ORIGIN},
    )
    assert unknown.status_code == bad_password.status_code == 401
    assert unknown.json()["message"] == bad_password.json()["message"]
    for response in (rejected, duplicate, unknown, bad_password):
        assert PASSWORD not in response.text
        assert response.json()["request_id"] == response.headers["X-Request-ID"]


def test_unhandled_failure_uses_generic_error_and_request_id(client: TestClient) -> None:
    with TestClient(client.app, base_url=ORIGIN, raise_server_exceptions=False) as failure_client:
        with patch.object(
            client.app.state.identity_service,
            "register",
            side_effect=RuntimeError("private diagnostic text"),
        ):
            response = failure_client.post(
                "/api/auth/register",
                json={"username": "sample_user", "password": PASSWORD, "adult_declared": True},
                headers={"Origin": ORIGIN},
            )
    assert response.status_code == 500
    assert response.json()["code"] == "INTERNAL_ERROR"
    assert response.json()["request_id"] == response.headers["X-Request-ID"]
    assert "private diagnostic text" not in response.text


def test_origin_csrf_rate_limit_and_expired_session(client: TestClient) -> None:
    missing_origin = client.post(
        "/api/auth/register",
        json={"username": "sample_user", "password": PASSWORD, "adult_declared": True},
    )
    assert missing_origin.status_code == 403
    register(client)
    csrf_token = client.get("/api/auth/csrf").json()["csrf_token"]
    assert (
        client.post(
            "/api/auth/logout", headers={"Origin": ORIGIN, "X-CSRF-Token": csrf_token + "x"}
        ).status_code
        == 403
    )
    assert client.get("/api/auth/me").status_code == 200

    for _ in range(5):
        failed = client.post(
            "/api/auth/login",
            json={"username": "sample_user", "password": "incorrect password 123"},
            headers={"Origin": ORIGIN},
        )
        assert failed.status_code == 401
    limited = client.post(
        "/api/auth/login",
        json={"username": "sample_user", "password": PASSWORD},
        headers={"Origin": ORIGIN},
    )
    assert limited.status_code == 429

    assert DATABASE_URL is not None
    engine = create_engine(DATABASE_URL)
    with engine.begin() as connection:
        connection.execute(
            text("UPDATE sessions SET last_seen_at = :then"),
            {"then": datetime.now(timezone.utc) - timedelta(minutes=31)},
        )
    engine.dispose()
    assert client.get("/api/auth/me").status_code == 401

    engine = create_engine(DATABASE_URL)
    with engine.begin() as connection:
        connection.execute(
            text("UPDATE sessions SET last_seen_at = :now, expires_at = :then"),
            {
                "now": datetime.now(timezone.utc),
                "then": datetime.now(timezone.utc) - timedelta(seconds=1),
            },
        )
    engine.dispose()
    assert client.get("/api/auth/me").status_code == 401
