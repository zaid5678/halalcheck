"""OpenRouter client: reads ingredient labels from photos and reviews ingredients."""

import base64
import logging
from pathlib import Path

import httpx
from pydantic import BaseModel

from app.config import Settings
from app.models.halal import Reason

logger = logging.getLogger(__name__)

_RULINGS = (Path(__file__).parent.parent / "data" / "rulings.json").read_text("utf-8")
_SYSTEM_PROMPT = f"""You check food ingredients for UK Muslim consumers.
If an image is given, first transcribe the product's ingredients list exactly as printed.
Then list every ingredient that is haram or doubtful. Use these rulings as the standard:
{_RULINGS}
For ingredients not covered above, use mainstream Sunni scholarship and be cautious: if an
ingredient's source is unclear, it is doubtful. Meat is doubtful unless halal certification is
stated. Never list halal ingredients.
Reply with JSON only:
{{"ingredients_text": "<transcribed list, or null if no image or no ingredients list visible>",
  "reasons": [{{"ingredient": "<as written>", "ruling": "haram" | "doubtful",
               "note": "<why, in under 12 words>"}}]}}"""


class LLMError(Exception):
    code = "llm_unavailable"
    status_code = 503
    message = "The ingredient checker is currently unavailable. Please try again shortly."


class LLMReview(BaseModel):
    ingredients_text: str | None = None
    reasons: list[Reason] = []


class LLMClient:
    def __init__(self, http: httpx.AsyncClient, settings: Settings) -> None:
        self._http = http
        self._settings = settings

    async def review(
        self, ingredients_text: str | None = None, image: bytes | None = None, image_type: str = ""
    ) -> LLMReview:
        if not self._settings.openrouter_api_key:
            raise LLMError()
        content: list[dict[str, object]] = []
        if ingredients_text:
            content.append({"type": "text", "text": f"Ingredients: {ingredients_text}"})
        if image:
            data_url = f"data:{image_type};base64,{base64.b64encode(image).decode()}"
            content.append({"type": "image_url", "image_url": {"url": data_url}})
        try:
            response = await self._http.post(
                self._settings.openrouter_url,
                headers={"Authorization": f"Bearer {self._settings.openrouter_api_key}"},
                json={
                    "model": self._settings.llm_model,
                    "messages": [
                        {"role": "system", "content": _SYSTEM_PROMPT},
                        {"role": "user", "content": content},
                    ],
                    "response_format": {"type": "json_object"},
                },
                timeout=self._settings.llm_timeout,
            )
            response.raise_for_status()
            return LLMReview.model_validate_json(
                response.json()["choices"][0]["message"]["content"]
            )
        except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as exc:
            logger.warning("LLM review failed: %s", exc)
            raise LLMError() from exc


class UnreadableImageError(LLMError):
    code = "unreadable_image"
    status_code = 422
    message = "No ingredients list could be read from this photo. Try a clearer, closer photo."
