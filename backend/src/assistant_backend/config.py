from urllib.parse import urlsplit

from pydantic import Field, SecretStr, ValidationInfo, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration; product limits remain unset until their stage gate."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "development"
    database_url: str = "postgresql+psycopg://shixu:change-me@localhost:5432/shixu"
    session_cookie_name: str = "shixu_session"
    app_origin: str = "http://localhost:8000"
    csrf_secret: str = "development-only-change-me"
    openai_next_api_key: SecretStr | None = None
    openai_next_base_url: str = "https://api.openai-next.com/v1"
    openai_next_model: str = "deepseek-v3.2"
    mimo_api_key: SecretStr | None = None
    mimo_base_url: str = "https://api.xiaomimimo.com/v1"
    mimo_model: str = "mimo-v2.6-flash"
    agent_max_model_requests: int = Field(default=16, gt=0)
    agent_max_tool_calls: int = Field(default=16, gt=0)
    agent_max_run_seconds: int = Field(default=180, gt=0)
    agent_max_input_tokens: int = Field(default=64_000, gt=0)
    agent_max_output_tokens: int = Field(default=8_000, gt=0)
    agent_user_hour_limit: int = Field(default=10, gt=0)
    agent_user_concurrent_limit: int = Field(default=2, gt=0)
    agent_ip_hour_limit: int = Field(default=30, gt=0)
    agent_global_minute_limit: int = Field(default=10, gt=0)
    agent_event_retention_days: int = Field(default=7, gt=0)
    speech_model_path: str | None = None

    @field_validator("openai_next_base_url", "mimo_base_url")
    @classmethod
    def validate_model_base_url(cls, value: str, info: ValidationInfo) -> str:
        host = (
            "api.openai-next.com"
            if info.field_name == "openai_next_base_url"
            else "api.xiaomimimo.com"
        )
        parsed = urlsplit(value)
        if (
            parsed.scheme != "https"
            or parsed.netloc != host
            or parsed.query
            or parsed.fragment
            or parsed.path.rstrip("/") != "/v1"
        ):
            raise ValueError(f"{info.field_name.upper()} must use the official HTTPS API endpoint")
        return f"https://{host}/v1"

    @property
    def chat_provider(self) -> tuple[SecretStr | None, str, str]:
        return self.mimo_api_key, self.mimo_base_url, self.mimo_model

    @model_validator(mode="after")
    def validate_production(self) -> "Settings":
        if self.app_env == "production":
            if not self.app_origin.startswith("https://"):
                raise ValueError("Production APP_ORIGIN must use HTTPS")
            if not self.session_cookie_name.startswith("__Host-"):
                raise ValueError("Production session Cookie must use __Host- prefix")
            if len(self.csrf_secret) < 32 or self.csrf_secret == "development-only-change-me":
                raise ValueError("Production CSRF_SECRET must be a unique 32+ character secret")
        return self
