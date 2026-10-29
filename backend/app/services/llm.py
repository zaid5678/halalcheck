"""OpenRouter client that reviews barcode ingredient lists for halal concerns."""

import logging
from pathlib import Path

import httpx
from pydantic import BaseModel

from app.config import Settings
from app.errors import AppError
from app.models.halal import Reason

logger = logging.getLogger(__name__)

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


class LLMError(AppError):
    code = "llm_unavailable"
    status_code = 503
    message = "The ingredient checker is currently unavailable. Please try again shortly."


class LLMReview(BaseModel):
    reasons: list[Reason] = []


class LLMClient:
    def __init__(self, http: httpx.AsyncClient, settings: Settings) -> None:
        self._http = http
        self._settings = settings

    async def review(self, ingredients_text: str) -> LLMReview:
        key = self._settings.openrouter_api_key
        if not self._settings.ai_configured or key is None:
            raise LLMError()
        content = [{"type": "text", "text": f"Ingredients: {ingredients_text}"}]
        try:
            response = await self._http.post(
                f"{self._settings.openrouter_base_url}/chat/completions",
                headers={"Authorization": f"Bearer {key.get_secret_value()}"},
                json={
                    "model": self._settings.openrouter_model,
                    "messages": [
                        {"role": "system", "content": _SYSTEM_PROMPT},
                        {"role": "user", "content": content},
                    ],
                    "response_format": {"type": "json_object"},
                },
                timeout=self._settings.openrouter_timeout_seconds,
            )
            response.raise_for_status()
            return LLMReview.model_validate_json(
                response.json()["choices"][0]["message"]["content"]
            )
        except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as exc:
            logger.warning("LLM review failed: %s", exc)
            raise LLMError() from exc
