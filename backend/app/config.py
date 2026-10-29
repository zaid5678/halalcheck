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

    # Ingredients OCR
    # Path to the tesseract binary; leave unset to find it on PATH.
    tesseract_cmd: str | None = None
    # Tesseract language codes joined with "+", e.g. "eng+fra". Each needs its traineddata pack.
    ocr_languages: str = "eng"
    ocr_max_upload_bytes: int = Field(default=10 * 1024 * 1024, ge=1)
    ocr_max_image_pixels: int = Field(default=40_000_000, ge=1)
    # Seconds allowed for a single Tesseract run before it is abandoned.
    ocr_timeout_seconds: float = Field(default=45.0, gt=0)
    # OCR is CPU-heavy; limit how many images are processed at once.
    ocr_max_concurrency: int = Field(default=2, ge=1)

    @field_validator("cors_origins", mode="before")
    @classmethod
    def split_origins(cls, value: object) -> object:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        return value


@lru_cache
def get_settings() -> Settings:
    return Settings()
