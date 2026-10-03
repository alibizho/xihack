"""Ephemeral speech draft calibration and bounded local audio fallback."""

import hashlib
import hmac
import io
import multiprocessing
import re
import unicodedata
import wave
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from multiprocessing.connection import Connection
from typing import Protocol
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, sessionmaker

from assistant_backend.config import Settings
from assistant_backend.infrastructure.models import AuthRateLimit


MAX_AUDIO_BYTES = 1_048_576
MAX_AUDIO_SECONDS = 20


@dataclass
class SpeechFailure(Exception):
    code: str
    status: int
    message: str


class AudioTranscriber(Protocol):
    def transcribe(self, samples: bytes) -> str: ...


def _transcribe_in_child(model_path: str, samples: bytes, connection: Connection) -> None:
    """Keep model loading and inference in a process that can be stopped on timeout."""
    try:
        import numpy as np
        from faster_whisper import WhisperModel

        model = WhisperModel(model_path, device="cpu", compute_type="int8", local_files_only=True)
        audio = np.frombuffer(samples, dtype="<i2").astype(np.float32) / 32768.0
        segments, _ = model.transcribe(audio, language="zh", beam_size=3)
        connection.send((True, "".join(segment.text for segment in segments).strip()))
    except Exception:
        connection.send((False, ""))
    finally:
        connection.close()


class LocalWhisperTranscriber:
    def __init__(self, model_path: str | None, timeout_seconds: int = 60) -> None:
        self.model_path = model_path
        self.timeout_seconds = timeout_seconds

    def transcribe(self, samples: bytes) -> str:
        if not self.model_path or not Path(self.model_path).is_dir():
            raise SpeechFailure("TRANSCRIPTION_UNAVAILABLE", 503, "Audio fallback unavailable")
        context = multiprocessing.get_context("spawn")
        parent, child = context.Pipe(duplex=False)
        process = context.Process(
            target=_transcribe_in_child, args=(self.model_path, samples, child), daemon=True
        )
        started = False
        try:
            process.start()
            started = True
            child.close()
            if not parent.poll(self.timeout_seconds):
                raise SpeechFailure("TRANSCRIPTION_TIMEOUT", 503, "Audio fallback timed out")
            try:
                success, transcript = parent.recv()
            except EOFError as exc:
                raise SpeechFailure("TRANSCRIPTION_FAILED", 503, "Audio fallback failed") from exc
            if not success:
                raise SpeechFailure("TRANSCRIPTION_FAILED", 503, "Audio fallback failed")
            return transcript
        except SpeechFailure:
            raise
        except Exception as exc:
            raise SpeechFailure("TRANSCRIPTION_FAILED", 503, "Audio fallback failed") from exc
        finally:
            parent.close()
            child.close()
            if started and process.is_alive():
                process.terminate()
                process.join(timeout=2)
                if process.is_alive():
                    process.kill()
            if started:
                process.join(timeout=2)


def _calendar_date(text: str, now: datetime) -> tuple[str | None, bool]:
    explicit = re.search(r"(?<!\d)(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})日?", text)
    if explicit:
        try:
            return datetime(*map(int, explicit.groups())).date().isoformat(), False
        except ValueError:
            return None, True
    for word, days in (("后天", 2), ("明天", 1), ("今天", 0)):
        if word in text:
            return (now + timedelta(days=days)).date().isoformat(), False
    return None, False


def _clock_time(text: str) -> tuple[str | None, bool]:
    def number(value: str) -> int:
        if value.isdecimal():
            return int(value)
        digits = {character: index for index, character in enumerate("零一二三四五六七八九")}
        digits["〇"] = 0
        digits["两"] = 2
        if "十" in value:
            tens, ones = value.split("十", 1)
            return (digits[tens] if tens else 1) * 10 + (digits[ones] if ones else 0)
        if len(value) != 1 or value not in digits:
            raise ValueError("Invalid spoken number")
        return digits[value]

    match = re.search(
        r"(?:(上午|下午|晚上|中午|凌晨)\s*)?([零〇一二两三四五六七八九十\d]{1,3})[:点时]([零〇一二两三四五六七八九十\d]{1,3}|半)?分?",
        text,
    )
    if not match:
        return None, False
    period, hour_text, minute_text = match.groups()
    try:
        hour = number(hour_text)
        minute = 30 if minute_text == "半" else number(minute_text) if minute_text else 0
    except (KeyError, ValueError):
        return None, True
    if hour > 23 or minute > 59 or (period and hour > 12):
        return None, True
    if period in {"下午", "晚上", "中午"} and hour < 12:
        hour += 12
    if period == "凌晨" and hour == 12:
        hour = 0
    return f"{hour:02d}:{minute:02d}", False


def calibrate(text: str, timezone_name: str, confidence: float | None = None) -> dict:
    try:
        local_zone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        raise SpeechFailure("INVALID_REQUEST", 422, "Invalid timezone") from exc
    normalized = " ".join(unicodedata.normalize("NFKC", text).split())
    if not normalized or len(normalized) > 8000:
        raise SpeechFailure("INVALID_REQUEST", 422, "Invalid draft text")
    local_now = datetime.now(timezone.utc).astimezone(local_zone)
    due_date, invalid_date = _calendar_date(normalized, local_now)
    due_time, invalid_time = _clock_time(normalized)
    due = None
    if due_date and not (invalid_date or invalid_time):
        if due_time:
            due = {
                "precision": "minute",
                "at": datetime.fromisoformat(f"{due_date}T{due_time}")
                .replace(tzinfo=local_zone)
                .isoformat(),
                "timezone": timezone_name,
            }
        else:
            due = {"precision": "date", "date": due_date, "timezone": timezone_name}
    if any(word in normalized for word in ("删除", "删掉")):
        intent = "delete"
    elif any(word in normalized for word in ("完成", "做完")):
        intent = "complete"
    elif any(word in normalized for word in ("修改", "改成", "更新")):
        intent = "update"
    elif any(word in normalized for word in ("创建", "新建", "新增", "记下", "提醒我")):
        intent = "create"
    elif any(word in normalized for word in ("查询", "查看", "有什么", "哪些")):
        intent = "query"
    else:
        intent = "unclear"
    question = None
    if invalid_date or invalid_time:
        question = "日期或时间无法确认，请修改草稿。"
    elif due_time and not due_date:
        question = "请补充日期，以便确定具体时间。"
    elif intent in {"update", "complete", "delete"} and re.fullmatch(
        r"(?:请)?(?:删除|删掉|完成|做完|修改|改成|更新)(?:这个|该|任务|事务|这件事)?[。.!！]?",
        normalized,
    ):
        question = "请确认要操作的具体任务。"
    elif intent == "create" and re.fullmatch(
        r"(?:请)?(?:创建|新建|新增|记下|提醒我)(?:一个任务|任务)?[。.!！]?", normalized
    ):
        question = "请补充要记录的任务内容。"
    return {
        "draft_text": normalized,
        "intent": intent,
        "due": due,
        "needs_clarification": question is not None,
        "clarification": question,
        "fallback_suggested": (confidence is not None and confidence < 0.55)
        or question is not None,
    }


def validate_wav(data: bytes) -> bytes:
    if not data or len(data) > MAX_AUDIO_BYTES:
        raise SpeechFailure("AUDIO_LIMIT_EXCEEDED", 413, "Audio size limit exceeded")
    try:
        with wave.open(io.BytesIO(data), "rb") as wav:
            if (
                wav.getnchannels() != 1
                or wav.getsampwidth() != 2
                or wav.getframerate() != 16000
                or wav.getcomptype() != "NONE"
            ):
                raise SpeechFailure("AUDIO_INVALID", 422, "Unsupported audio format")
            if wav.getnframes() == 0 or wav.getnframes() > 16000 * MAX_AUDIO_SECONDS:
                raise SpeechFailure("AUDIO_LIMIT_EXCEEDED", 413, "Audio duration limit exceeded")
            samples = wav.readframes(wav.getnframes())
            if len(samples) != wav.getnframes() * 2:
                raise SpeechFailure("AUDIO_INVALID", 422, "Invalid audio")
            return samples
    except (EOFError, wave.Error) as exc:
        raise SpeechFailure("AUDIO_INVALID", 422, "Invalid audio") from exc


class SpeechService:
    def __init__(
        self,
        factory: sessionmaker[Session],
        settings: Settings,
        transcriber: AudioTranscriber | None = None,
    ) -> None:
        self.factory = factory
        self.settings = settings
        self.transcriber = transcriber or LocalWhisperTranscriber(settings.speech_model_path)

    def audio_fallback(
        self, user_id: str, ip_address: str, data: bytes, timezone_name: str
    ) -> dict:
        samples = validate_wav(data)
        self._consume_limits(user_id, ip_address)
        transcript = self.transcriber.transcribe(samples)
        if not transcript:
            raise SpeechFailure("TRANSCRIPTION_FAILED", 422, "No speech recognized")
        return calibrate(transcript, timezone_name)

    def _consume_limits(self, user_id: str, ip_address: str) -> None:
        now = datetime.now(timezone.utc)
        windows = (
            ("speech_user_day", user_id, 86400, 5),
            ("speech_ip_day", ip_address, 86400, 20),
            ("speech_global_minute", "global", 60, 10),
        )
        table = AuthRateLimit.__table__
        with self.factory.begin() as session:
            for scope, subject, seconds, limit in windows:
                start = datetime.fromtimestamp(
                    int(now.timestamp()) // seconds * seconds, tz=timezone.utc
                )
                subject_hash = hmac.new(
                    self.settings.csrf_secret.encode(),
                    f"limit:{scope}:{subject}".encode(),
                    hashlib.sha256,
                ).hexdigest()
                statement = insert(table).values(
                    scope=scope, subject_hash=subject_hash, window_start=start, attempts=1
                )
                statement = statement.on_conflict_do_update(
                    index_elements=[table.c.scope, table.c.subject_hash, table.c.window_start],
                    set_={"attempts": table.c.attempts + 1},
                ).returning(table.c.attempts)
                attempts = session.scalar(statement)
                if attempts is not None and attempts > limit:
                    raise SpeechFailure("RATE_LIMITED", 429, "Audio fallback limit reached")
