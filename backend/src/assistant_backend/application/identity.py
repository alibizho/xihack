import hashlib
import hmac
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from argon2 import PasswordHasher, Type
from argon2.exceptions import VerifyMismatchError
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from assistant_backend.config import Settings
from assistant_backend.infrastructure.models import AuthRateLimit, LoginSession, User


USERNAME_PATTERN = re.compile(r"^[A-Za-z0-9_]{3,32}$")
IDLE_TIMEOUT = timedelta(minutes=30)
ABSOLUTE_TIMEOUT = timedelta(hours=8)
PASSWORD_HASHER = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1, type=Type.ID)
_DUMMY_PASSWORD_HASH = PASSWORD_HASHER.hash("dummy-password-for-missing-account")


@dataclass
class AuthFailure(Exception):
    code: str
    status: int
    message: str


@dataclass(frozen=True)
class SessionIdentity:
    user_id: str
    username: str
    token_hash: str


@dataclass(frozen=True)
class LoginResult:
    username: str
    token: str


class IdentityService:
    def __init__(self, factory: sessionmaker[Session], settings: Settings) -> None:
        self.factory = factory
        self.settings = settings

    def register(
        self, username: str, password: str, adult_declared: bool, ip: str, old_token: str | None
    ) -> LoginResult:
        self._consume_limit("register_ip", ip, timedelta(hours=1), 5)
        if not adult_declared:
            raise AuthFailure("INVALID_REQUEST", 422, "Adult declaration is required")
        normalized = self._normalize_username(username)
        now = self._now()
        token = secrets.token_urlsafe(32)
        try:
            with self.factory.begin() as session:
                if session.scalar(
                    select(User.user_id).where(User.username_normalized == normalized)
                ):
                    raise AuthFailure("REGISTRATION_UNAVAILABLE", 409, "Registration unavailable")
                user_id = str(uuid4())
                session.add(
                    User(
                        user_id=user_id,
                        username=username,
                        username_normalized=normalized,
                        password_hash=PASSWORD_HASHER.hash(password),
                        adult_declared=True,
                        created_at=now,
                    )
                )
                session.flush()
                session.add(self._new_session(user_id, token, now))
                self._revoke_old_session(session, old_token, now)
        except IntegrityError as exc:
            raise AuthFailure("REGISTRATION_UNAVAILABLE", 409, "Registration unavailable") from exc
        return LoginResult(username=username, token=token)

    def login(self, username: str, password: str, ip: str, old_token: str | None) -> LoginResult:
        normalized = self._normalize_username(username)
        self._consume_limit("login_ip", ip, timedelta(minutes=15), 20)
        self._consume_limit("login_account", normalized, timedelta(minutes=15), 5)
        with self.factory() as session:
            user = session.scalar(select(User).where(User.username_normalized == normalized))
            stored_hash = user.password_hash if user else _DUMMY_PASSWORD_HASH
            try:
                valid = PASSWORD_HASHER.verify(stored_hash, password)
            except VerifyMismatchError:
                valid = False
            if not valid or user is None:
                raise AuthFailure("AUTH_INVALID", 401, "Invalid username or password")
            user_id, display_name = user.user_id, user.username

        now = self._now()
        token = secrets.token_urlsafe(32)
        with self.factory.begin() as session:
            session.add(self._new_session(user_id, token, now))
            self._revoke_old_session(session, old_token, now)
        return LoginResult(username=display_name, token=token)

    def current(self, token: str | None) -> SessionIdentity:
        if not token:
            raise AuthFailure("AUTH_REQUIRED", 401, "Authentication required")
        now = self._now()
        token_hash = self._hash_token(token)
        with self.factory.begin() as session:
            row = session.execute(
                select(LoginSession, User)
                .join(User, User.user_id == LoginSession.user_id)
                .where(LoginSession.token_hash == token_hash)
                .with_for_update(of=LoginSession)
            ).first()
            if row is None:
                raise AuthFailure("AUTH_REQUIRED", 401, "Authentication required")
            login_session, user = row
            if (
                login_session.revoked_at is not None
                or now >= login_session.expires_at
                or now - login_session.last_seen_at >= IDLE_TIMEOUT
            ):
                raise AuthFailure("AUTH_REQUIRED", 401, "Authentication required")
            login_session.last_seen_at = now
            return SessionIdentity(user.user_id, user.username, token_hash)

    def logout(self, identity: SessionIdentity) -> None:
        with self.factory.begin() as session:
            session.execute(
                update(LoginSession)
                .where(LoginSession.token_hash == identity.token_hash)
                .values(revoked_at=self._now())
            )

    def csrf_token(self, token: str) -> str:
        return hmac.new(
            self.settings.csrf_secret.encode(), f"csrf:{token}".encode(), hashlib.sha256
        ).hexdigest()

    def verify_csrf(self, token: str, submitted: str | None) -> None:
        if not submitted or not hmac.compare_digest(self.csrf_token(token), submitted):
            raise AuthFailure("CSRF_INVALID", 403, "CSRF token invalid")

    def _consume_limit(self, scope: str, subject: str, window: timedelta, limit: int) -> None:
        now = self._now()
        window_seconds = int(window.total_seconds())
        window_start = datetime.fromtimestamp(
            int(now.timestamp()) // window_seconds * window_seconds, tz=timezone.utc
        )
        subject_hash = hmac.new(
            self.settings.csrf_secret.encode(), f"limit:{scope}:{subject}".encode(), hashlib.sha256
        ).hexdigest()
        table = AuthRateLimit.__table__
        statement = insert(table).values(
            scope=scope, subject_hash=subject_hash, window_start=window_start, attempts=1
        )
        statement = statement.on_conflict_do_update(
            index_elements=[table.c.scope, table.c.subject_hash, table.c.window_start],
            set_={"attempts": table.c.attempts + 1},
        ).returning(table.c.attempts)
        with self.factory.begin() as session:
            attempts = session.scalar(statement)
        if attempts is not None and attempts > limit:
            raise AuthFailure("RATE_LIMITED", 429, "Too many attempts; try again later")

    @staticmethod
    def _normalize_username(username: str) -> str:
        if not USERNAME_PATTERN.fullmatch(username):
            raise AuthFailure("INVALID_REQUEST", 422, "Invalid username")
        return username.lower()

    @staticmethod
    def _new_session(user_id: str, token: str, now: datetime) -> LoginSession:
        return LoginSession(
            token_hash=IdentityService._hash_token(token),
            user_id=user_id,
            created_at=now,
            last_seen_at=now,
            expires_at=now + ABSOLUTE_TIMEOUT,
        )

    @staticmethod
    def _revoke_old_session(session: Session, old_token: str | None, now: datetime) -> None:
        if old_token:
            session.execute(
                update(LoginSession)
                .where(LoginSession.token_hash == IdentityService._hash_token(old_token))
                .values(revoked_at=now)
            )

    @staticmethod
    def _hash_token(token: str) -> str:
        return hashlib.sha256(token.encode()).hexdigest()

    @staticmethod
    def _now() -> datetime:
        return datetime.now(timezone.utc)
