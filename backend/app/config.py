"""Central application settings, loaded from environment variables or a .env file."""

from functools import lru_cache
from typing import Annotated

from pydantic import Field, field_validator
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

    # Open Food Facts
    off_base_url: str = "https://world.openfoodfacts.org"
    # Search-a-licious: Open Food Facts' Elasticsearch-backed full-text search service.
    off_search_url: str = "https://search.openfoodfacts.org/search"
    # Legacy full-text search, used as a fallback when the search service is unavailable.
    off_legacy_search_url: str = "https://world.openfoodfacts.org/cgi/search.pl"
    # Open Food Facts asks every client to identify itself: AppName/Version (ContactEmail).
    off_user_agent: str = "HalalCheck/0.1 (contact@example.com)"
    off_connect_timeout: float = 5.0
    off_read_timeout: float = 10.0

    search_page_size: int = Field(default=24, ge=1, le=100)

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
