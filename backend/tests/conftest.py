import io
import json
from collections.abc import Callable, Iterator
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageFont

from app.ai.analysis import IngredientsAnalyzer
from app.ai.openrouter import OpenRouterClient
from app.api.ingredients import get_analyzer, get_rate_limiter
from app.config import Settings
from app.main import app
from app.rate_limit import SlidingWindowRateLimiter

Handler = Callable[[httpx.Request], httpx.Response]


class FakeOpenRouter:
    """Stands in for the OpenRouter API and records the requests sent to it."""

    def __init__(self) -> None:
        self.handler: Handler = lambda _request: chat_response(valid_analysis())
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self.handler(request)

    @property
    def last_body(self) -> dict[str, Any]:
        body: dict[str, Any] = json.loads(self.requests[-1].content)
        return body


def make_settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "OPENROUTER_API_KEY": "test-key",
        "OPENROUTER_MODEL": "test/vision-model",
    }
    values.update(overrides)
    return Settings(**values)


@pytest.fixture
def settings(request: pytest.FixtureRequest) -> Settings:
    return make_settings(**getattr(request, "param", {}))


@pytest.fixture
def openrouter() -> FakeOpenRouter:
    return FakeOpenRouter()


@pytest.fixture
def limiter(request: pytest.FixtureRequest) -> SlidingWindowRateLimiter:
    limiter: SlidingWindowRateLimiter = getattr(
        request, "param", SlidingWindowRateLimiter(limit=100)
    )
    return limiter


@pytest.fixture
def client(
    openrouter: FakeOpenRouter, settings: Settings, limiter: SlidingWindowRateLimiter
) -> Iterator[TestClient]:
    http = httpx.AsyncClient(
        base_url=settings.openrouter_base_url, transport=httpx.MockTransport(openrouter)
    )

    def analyzer() -> IngredientsAnalyzer:
        return IngredientsAnalyzer(
            OpenRouterClient(http, settings),
            model=settings.openrouter_model,
            structured_outputs=settings.openrouter_structured_outputs,
        )

    app.dependency_overrides[get_analyzer] = analyzer
    app.dependency_overrides[get_rate_limiter] = lambda: limiter
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


# --- Model output builders -------------------------------------------------------------------


def ingredient(original: str, **overrides: Any) -> dict[str, Any]:
    finding: dict[str, Any] = {
        "original_text": original,
        "standardised_name": original.capitalize(),
        "translation": None,
        "e_number": None,
        "possible_sources": ["plant"],
        "source_established": False,
        "assessment": "likely_permissible",
        "explanation": f"{original} is plant-derived.",
        "evidence": "General knowledge of how it is made.",
        "evidence_basis": "general_knowledge",
        "needs_more_information": False,
    }
    finding.update(overrides)
    return finding


def valid_analysis(**overrides: Any) -> dict[str, Any]:
    analysis: dict[str, Any] = {
        "label_readable": True,
        "readability_notes": None,
        "detected_language": ["English"],
        "extracted_ingredients_text": "Ingredients: sugar, salt.",
        "overall_status": "likely_halal",
        "confidence": "medium",
        "summary": "No ingredients of concern were identified.",
        "ingredients": [ingredient("sugar"), ingredient("salt", possible_sources=["mineral"])],
        "prohibited_findings": [],
        "concerns": [],
        "certification_information": {"marks_visible": [], "notes": "None visible."},
        "limitations": ["No external verification."],
        "next_steps": ["Check for a recognised halal certification."],
    }
    analysis.update(overrides)
    return analysis


def chat_response(
    content: object, *, finish_reason: str = "stop", status_code: int = 200
) -> httpx.Response:
    text = content if isinstance(content, str) else json.dumps(content, ensure_ascii=False)
    return httpx.Response(
        status_code,
        json={
            "id": "gen-1",
            "model": "test/vision-model",
            "choices": [
                {
                    "index": 0,
                    "finish_reason": finish_reason,
                    "message": {"role": "assistant", "content": text},
                }
            ],
        },
    )


# --- Images -----------------------------------------------------------------------------------


def encode(image: Image.Image, image_format: str = "JPEG", **options: object) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, image_format, **options)
    return buffer.getvalue()


def make_label(lines: list[str], size: tuple[int, int] = (1400, 420)) -> Image.Image:
    """Render a fake ingredients label as dark text on a beige background."""
    image = Image.new("RGB", size, (235, 228, 210))
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=44)
    for index, line in enumerate(lines):
        draw.text((40, 40 + index * 90), line, fill=(40, 30, 30), font=font)
    return image
