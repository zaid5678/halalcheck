"""Minimal OpenRouter chat-completions client with error mapping."""

import logging
from typing import Any

import httpx

from app.config import Settings
from app.errors import AppError

logger = logging.getLogger(__name__)


class AiNotConfiguredError(AppError):
    code = "ai_not_configured"
    status_code = 503
    message = "Ingredient analysis isn't set up on the server yet. Please try again later."


class AiUnavailableError(AppError):
    code = "ai_unavailable"
    status_code = 503
    message = "The analysis service is temporarily unavailable. Please try again shortly."


class AiRateLimitedError(AppError):
    code = "ai_rate_limited"
    status_code = 429
    message = "The analysis service is busy. Please wait a moment and try again."


class AiTimeoutError(AppError):
    code = "ai_timeout"
    status_code = 504
    message = "The analysis took too long. Please try again."


class AiRequestRejectedError(AppError):
    code = "ai_request_rejected"
    status_code = 502
    message = "The analysis service couldn't process this image. Please try a different photo."


class AiInvalidResponseError(AppError):
    code = "ai_invalid_response"
    status_code = 502
    message = "The analysis came back incomplete or in an unexpected format. Please try again."


def build_http_client(settings: Settings) -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=settings.openrouter_base_url,
        timeout=httpx.Timeout(settings.openrouter_timeout_seconds, connect=10.0),
    )


class OpenRouterClient:
    def __init__(self, http: httpx.AsyncClient, settings: Settings) -> None:
        self._http = http
        self._settings = settings

    async def complete(
        self, messages: list[dict[str, Any]], *, schema: dict[str, Any] | None
    ) -> str:
        """Send a chat completion and return the assistant's text content."""
        settings = self._settings
        api_key = settings.openrouter_api_key
        if api_key is None or not api_key.get_secret_value().strip():
            raise AiNotConfiguredError()

        # Only widely supported parameters are sent (some models reject e.g. temperature), so any
        # vision model with structured outputs can be swapped in via OPENROUTER_MODEL.
        body: dict[str, Any] = {
            "model": settings.openrouter_model,
            "messages": messages,
            "max_tokens": settings.openrouter_max_tokens,
        }
        if schema is not None:
            body["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": "label_analysis", "strict": True, "schema": schema},
            }
            # Only route to providers that honour the structured-output request.
            body["provider"] = {"require_parameters": True}

        headers = {
            "Authorization": f"Bearer {api_key.get_secret_value().strip()}",
            "HTTP-Referer": settings.openrouter_app_url,
            "X-Title": settings.openrouter_app_title,
        }

        try:
            response = await self._http.post("/chat/completions", json=body, headers=headers)
        except httpx.TimeoutException as exc:
            logger.warning("OpenRouter request timed out")
            raise AiTimeoutError() from exc
        except httpx.HTTPError as exc:
            logger.warning("OpenRouter request failed: %s", type(exc).__name__)
            raise AiUnavailableError() from exc

        try:
            data = response.json()
        except ValueError:
            data = None

        if response.status_code >= 400 or (isinstance(data, dict) and "error" in data):
            raise _map_error(response.status_code, data)
        if not isinstance(data, dict):
            raise AiInvalidResponseError()

        return _extract_content(data)


def _map_error(status: int, data: Any) -> AppError:
    error = data.get("error") if isinstance(data, dict) else None
    detail = error.get("message", "") if isinstance(error, dict) else ""
    code = error.get("code") if isinstance(error, dict) else None
    if isinstance(code, int) and status < 400:
        status = code
    # Log the provider's message for operators; never log the request (it contains the image).
    logger.warning("OpenRouter error %s: %s", status, str(detail)[:300])

    if status in (401, 403):
        return AiNotConfiguredError()
    if status == 402:
        # Out of credits: an operator problem, shown to users as a temporary outage.
        return AiUnavailableError()
    if status == 408:
        return AiTimeoutError()
    if status == 429:
        return AiRateLimitedError()
    if status == 404:
        # Unknown model, or no provider supports the request (e.g. image input or structured
        # outputs): a configuration problem, not the user's photo.
        logger.error(
            "Check that OPENROUTER_MODEL exists and supports image input and structured outputs"
            " (or set HALALCHECK_OPENROUTER_STRUCTURED_OUTPUTS=false)"
        )
        return AiUnavailableError()
    if status in (400, 413, 422):
        return AiRequestRejectedError()
    return AiUnavailableError()


def _extract_content(data: dict[str, Any]) -> str:
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise AiInvalidResponseError()
    choice = choices[0]
    if choice.get("finish_reason") == "length":
        logger.warning("OpenRouter response was cut off (max_tokens reached)")
        raise AiInvalidResponseError(
            "The analysis was cut off before it finished. Please try again."
        )

    message = choice.get("message")
    content = message.get("content") if isinstance(message, dict) else None
    # Some providers return content as a list of parts.
    if isinstance(content, list):
        content = "".join(part.get("text", "") for part in content if isinstance(part, dict))
    if not isinstance(content, str) or not content.strip():
        if isinstance(message, dict) and message.get("refusal"):
            logger.warning("Model refused the request")
        raise AiInvalidResponseError()
    return content
