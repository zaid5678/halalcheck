"""OpenRouter client for halal checks: reads ingredient labels and reviews ingredient lists."""

import base64
import logging
from pathlib import Path
from typing import Any, TypeVar

import httpx
from pydantic import BaseModel

from app.config import Settings
from app.errors import AppError
from app.models.halal import Reason

logger = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)

_RULINGS = (Path(__file__).parent.parent / "data" / "rulings.json").read_text("utf-8")
_SYSTEM_PROMPT = f"""You check food ingredients for UK Muslim consumers.
Then list every ingredient that is haram or doubtful. Use these rulings as the standard:
{_RULINGS}
For ingredients not covered above, use mainstream Sunni scholarship and be cautious: if an
ingredient's source is unclear, it is doubtful. Meat is doubtful unless halal certification is
stated. Never list halal ingredients.
Reply with JSON only:
{{"reasons": [{{"ingredient": "<as written>", "ruling": "haram" | "doubtful",
               "note": "<why, in under 12 words>"}}]}}"""
_READ_PROMPT = (
    "Transcribe the ingredients list on this food label exactly as printed, including "
    'E-numbers. Reply with JSON only: {"ingredients_text": "<the list>"}, or '
    '{"ingredients_text": null} if no ingredients list is visible.'
)


class LLMError(AppError):
    code = "llm_unavailable"
    status_code = 503
    message = "The ingredient checker is currently unavailable. Please try again shortly."


class UnreadableImageError(AppError):
    code = "unreadable_image"
    status_code = 422
    message = "No ingredients list could be read from this photo. Try a clearer, closer photo."


class LLMReview(BaseModel):
    reasons: list[Reason] = []


class LabelReading(BaseModel):
    ingredients_text: str | None = None


def _parse(model: type[T], raw: str) -> T:
    try:
        return model.model_validate_json(raw)
    except ValueError as exc:
        logger.warning("LLM reply was not valid: %s", exc)
        raise LLMError() from exc


class LLMClient:
    def __init__(self, http: httpx.AsyncClient, settings: Settings) -> None:
        self._http = http
        self._settings = settings

    async def review(self, ingredients_text: str) -> LLMReview:
        content = [{"type": "text", "text": f"Ingredients: {ingredients_text}"}]
        raw = await self._complete(
            [{"role": "system", "content": _SYSTEM_PROMPT}, {"role": "user", "content": content}]
        )
        return _parse(LLMReview, raw)

    async def read_label(self, image_jpeg: bytes) -> str | None:
        """Transcribe the ingredients list from a label photo; None if none is visible."""
        data_url = f"data:image/jpeg;base64,{base64.b64encode(image_jpeg).decode()}"
        content = [
            {"type": "text", "text": _READ_PROMPT},
            {"type": "image_url", "image_url": {"url": data_url}},
        ]
        raw = await self._complete([{"role": "user", "content": content}])
        text = _parse(LabelReading, raw).ingredients_text
        return text.strip() if text and text.strip() else None

    async def _complete(self, messages: list[dict[str, Any]]) -> str:
        key = self._settings.openrouter_api_key
        if not self._settings.ai_configured or key is None:
            raise LLMError()
        try:
            response = await self._http.post(
                f"{self._settings.openrouter_base_url}/chat/completions",
                headers={"Authorization": f"Bearer {key.get_secret_value()}"},
                json={
                    "model": self._settings.halal_model,
                    "messages": messages,
                    "reasoning": {"effort": "low"},
                    "max_tokens": 1500,
                    "response_format": {"type": "json_object"},
                },
                timeout=self._settings.openrouter_timeout_seconds,
            )
            response.raise_for_status()
            content: str = response.json()["choices"][0]["message"]["content"]
            # Some models wrap JSON in prose or code fences; keep only the object.
            return content[content.find("{") : content.rfind("}") + 1]
        except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as exc:
            logger.warning("LLM request failed: %s", exc)
            raise LLMError() from exc
