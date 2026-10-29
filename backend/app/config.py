"""Central application settings, loaded from environment variables or a .env file."""

from functools import lru_cache
from typing import Annotated

from pydantic import AliasChoices, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_prefix="HALALCHECK_",
        extra="ignore",
    )

    app_name: str = "HalalCheck API"
    log_level: str = "INFO"

    # Comma-separated list of origins allowed to call the API from a browser.
    cors_origins: Annotated[list[str], NoDecode] = Field(
        default=["http://localhost:5173", "http://127.0.0.1:5173"]
    )

    # Image uploads
    max_upload_bytes: int = Field(default=10 * 1024 * 1024, ge=1)
    max_image_pixels: int = Field(default=40_000_000, ge=1)

    # OpenRouter (AI ingredient analysis). The key is read from OPENROUTER_API_KEY; the
    # HALALCHECK_-prefixed name is also accepted.
    openrouter_api_key: SecretStr | None = Field(
        default=None,
        validation_alias=AliasChoices("OPENROUTER_API_KEY", "HALALCHECK_OPENROUTER_API_KEY"),
    )
    # Any OpenRouter model that accepts image input and structured outputs.
    openrouter_model: str = Field(
        default="anthropic/claude-sonnet-5.5",
        validation_alias=AliasChoices("OPENROUTER_MODEL", "HALALCHECK_OPENROUTER_MODEL"),
    )
    openrouter_base_url: str = "https://openrouter.ai/api/v1"
    # Sent to OpenRouter to identify the app (optional attribution headers).
    openrouter_app_url: str = "https://github.com/zaid5678/halalcheck"
    openrouter_app_title: str = "HalalCheck"
    # Set to false for models that don't support JSON-schema structured outputs.
    openrouter_structured_outputs: bool = True
    openrouter_timeout_seconds: float = Field(default=90.0, gt=0)
    openrouter_max_tokens: int = Field(default=6000, ge=500)
    # Longest image edge sent to the model. Larger photos are scaled down to save tokens.
    analysis_image_max_edge: int = Field(default=2048, ge=512)
    # Analyses allowed per client IP per hour, protecting the OpenRouter balance. 0 disables.
    analysis_rate_limit_per_hour: int = Field(default=30, ge=0)

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value

    @property
    def ai_configured(self) -> bool:
        return bool(self.openrouter_api_key and self.openrouter_api_key.get_secret_value().strip())


@lru_cache
def get_settings() -> Settings:
    return Settings()
