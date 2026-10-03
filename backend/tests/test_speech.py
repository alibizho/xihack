import io
import os
import wave
from collections.abc import Iterator
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from assistant_backend.application.speech import (
    LocalWhisperTranscriber,
    SpeechFailure,
    calibrate,
    validate_wav,
)
from assistant_backend.config import Settings
from assistant_backend.main import create_app


DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
ORIGIN = "https://test.example"


def test_narrated_task_can_reach_agent_without_keyword_clarification() -> None:
    draft = calibrate("我明天得交作业，晚上给妈妈打电话", "Asia/Shanghai")
    assert draft["intent"] == "unclear"
    assert draft["needs_clarification"] is False
    assert (
        calibrate("我已经完成初稿，明天要提交作业", "Asia/Shanghai")["needs_clarification"] is False
    )


@pytest.fixture
def client() -> Iterator[TestClient]:
    if DATABASE_URL is None:
        pytest.skip("TEST_DATABASE_URL is required")
    if not (make_url(DATABASE_URL).database or "").endswith("_test"):
        pytest.fail("TEST_DATABASE_URL must point to a dedicated *_test database")
    engine = create_engine(DATABASE_URL)
    with engine.begin() as connection:
        connection.execute(text("TRUNCATE auth_rate_limits, sessions, users CASCADE"))
    engine.dispose()
    settings = Settings(
        _env_file=None,
        database_url=DATABASE_URL,
        app_origin=ORIGIN,
        csrf_secret="test-secret-with-at-least-32-characters",
    )
    with TestClient(create_app(settings), base_url=ORIGIN) as test_client:
        yield test_client


def _headers(client: TestClient) -> dict[str, str]:
    return {
        "Origin": ORIGIN,
        "X-CSRF-Token": client.get("/api/auth/csrf").json()["csrf_token"],
    }


def _wav(seconds: float = 0.1, *, rate: int = 16000) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as recording:
        recording.setnchannels(1)
        recording.setsampwidth(2)
        recording.setframerate(rate)
        recording.writeframes(b"\0\0" * int(seconds * rate))
    return output.getvalue()


def test_speech_draft_is_calibrated_without_creating_message_or_run(client: TestClient) -> None:
    assert (
        client.post(
            "/api/transcriptions", json={"text": "test", "timezone": "Asia/Shanghai"}
        ).status_code
        == 403
    )
    registered = client.post(
        "/api/auth/register",
        json={
            "username": "speech_user",
            "password": "a long test passphrase 123",
            "adult_declared": True,
        },
        headers={"Origin": ORIGIN},
    )
    assert registered.status_code == 201
    response = client.post(
        "/api/transcriptions",
        json={
            "text": "  提醒我  2026年10月9日下午三点交周报  ",
            "timezone": "Asia/Shanghai",
            "confidence": 0.4,
        },
        headers=_headers(client),
    )
    assert response.status_code == 200
    result = response.json()
    assert result["intent"] == "create"
    assert result["due"] == {
        "precision": "minute",
        "at": "2026-10-09T15:00:00+08:00",
        "timezone": "Asia/Shanghai",
    }
    assert result["fallback_suggested"] is True
    assert (
        client.post(
            "/api/transcriptions",
            json={"text": "删除这个", "timezone": "Asia/Shanghai"},
            headers=_headers(client),
        ).json()["needs_clarification"]
        is True
    )
    assert (
        client.post(
            "/api/transcriptions",
            json={"text": "明天 25:00", "timezone": "Asia/Shanghai"},
            headers=_headers(client),
        ).json()["needs_clarification"]
        is True
    )
    assert (
        client.post(
            "/api/transcriptions",
            json={"text": "提醒我", "timezone": "Asia/Shanghai"},
            headers=_headers(client),
        ).json()["needs_clarification"]
        is True
    )
    engine = create_engine(DATABASE_URL)
    with engine.connect() as connection:
        for table in ("messages", "agent_runs", "proposals", "tasks"):
            assert connection.scalar(text(f"SELECT count(*) FROM {table}")) == 0
    engine.dispose()


def test_audio_fallback_requires_consent_and_validates_format_and_limits(
    client: TestClient,
) -> None:
    client.post(
        "/api/auth/register",
        json={
            "username": "audio_user",
            "password": "a long test passphrase 123",
            "adult_declared": True,
        },
        headers={"Origin": ORIGIN},
    )
    path = "/api/transcriptions/audio?timezone=Asia%2FShanghai&reason=user_retry"
    headers = {**_headers(client), "Content-Type": "audio/wav"}
    assert client.post(path, content=_wav(), headers=headers).status_code == 403
    headers["X-Audio-Consent"] = "true"
    assert client.post(path, content=b"not wave", headers=headers).json()["code"] == "AUDIO_INVALID"
    assert client.post(path, content=_wav(rate=8000), headers=headers).status_code == 422
    assert client.post(path, content=_wav(21), headers=headers).status_code == 413
    assert client.post(path, content=b"x" * 1_048_577, headers=headers).status_code == 413

    class FakeTranscriber:
        def transcribe(self, samples: bytes) -> str:
            assert len(samples) == 3200
            return "提醒我明天交周报"

    client.app.state.speech_service.transcriber = FakeTranscriber()
    response = client.post(path, content=_wav(), headers=headers)
    assert response.status_code == 200
    assert response.json()["intent"] == "create"
    assert response.json()["due"]["precision"] == "date"
    for _ in range(9):
        assert client.post(path, content=_wav(), headers=headers).status_code == 200
    assert client.post(path, content=_wav(), headers=headers).json()["code"] == "RATE_LIMITED"
    engine = create_engine(DATABASE_URL)
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT count(*) FROM messages")) == 0
        assert connection.scalar(text("SELECT count(*) FROM agent_runs")) == 0
    engine.dispose()


def test_wav_validator_rejects_corrupt_or_oversized_audio() -> None:
    with pytest.raises(SpeechFailure):
        validate_wav(b"\x00" * 100)
    with pytest.raises(SpeechFailure):
        validate_wav(_wav()[:-2])
    with pytest.raises(SpeechFailure):
        validate_wav(_wav(21))


def test_local_inference_timeout_stops_child(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    process = MagicMock()
    process.is_alive.side_effect = [True, False]
    parent = MagicMock()
    parent.poll.return_value = False
    child = MagicMock()
    context = MagicMock()
    context.Pipe.return_value = (parent, child)
    context.Process.return_value = process
    monkeypatch.setattr(
        "assistant_backend.application.speech.multiprocessing.get_context", lambda _: context
    )

    with pytest.raises(SpeechFailure) as failure:
        LocalWhisperTranscriber(str(tmp_path), timeout_seconds=1).transcribe(b"\0\0")
    assert failure.value.code == "TRANSCRIPTION_TIMEOUT"
    parent.poll.assert_called_once_with(1)
    process.terminate.assert_called_once()
    process.kill.assert_not_called()
    parent.close.assert_called_once()
    child.close.assert_called()
