import base64
import io
import json

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config import get_settings
from app.rate_limit import SlidingWindowRateLimiter
from tests.conftest import (
    FakeOpenRouter,
    chat_response,
    encode,
    ingredient,
    make_label,
    valid_analysis,
)

URL = "/api/ingredients/analyze"
LABEL = make_label(["Ingredients: sugar, gelatine, E471"])


def upload(client: TestClient, data: bytes, content_type: str = "image/jpeg", **form: str):  # type: ignore[no-untyped-def]
    return client.post(URL, files={"image": ("label.jpg", data, content_type)}, data=form)


def user_content(openrouter: FakeOpenRouter) -> list[dict[str, object]]:
    messages = openrouter.last_body["messages"]
    content: list[dict[str, object]] = messages[1]["content"]
    return content


# --- Successful analysis ---------------------------------------------------------------------


def test_analyses_a_photo(client: TestClient, openrouter: FakeOpenRouter) -> None:
    response = upload(client, encode(LABEL))

    assert response.status_code == 200
    body = response.json()
    assert body["overall_status"] == "likely_halal"
    assert body["model"] == "test/vision-model"
    assert body["used_corrected_text"] is False
    assert body["adjustments"] == []
    assert [i["original_text"] for i in body["ingredients"]] == ["sugar", "salt"]


def test_request_sent_to_openrouter(client: TestClient, openrouter: FakeOpenRouter) -> None:
    upload(client, encode(LABEL))

    request = openrouter.requests[0]
    assert request.url.path.endswith("/chat/completions")
    assert request.headers["authorization"] == "Bearer test-key"
    assert request.headers["x-title"] == "HalalCheck"
    body = openrouter.last_body
    assert body["model"] == "test/vision-model"
    assert "temperature" not in body
    assert body["response_format"]["type"] == "json_schema"
    assert body["response_format"]["json_schema"]["strict"] is True
    assert body["provider"] == {"require_parameters": True}
    assert body["messages"][0]["role"] == "system"
    assert "Missing information is never evidence" in body["messages"][0]["content"]

    image_part = user_content(openrouter)[1]
    assert image_part["type"] == "image_url"
    url = image_part["image_url"]["url"]  # type: ignore[index]
    assert url.startswith("data:image/jpeg;base64,")
    sent = Image.open(io.BytesIO(base64.b64decode(url.split(",", 1)[1])))
    assert sent.format == "JPEG"


def test_sends_png_and_webp_as_jpeg(client: TestClient, openrouter: FakeOpenRouter) -> None:
    for image_format, content_type in (("PNG", "image/png"), ("WEBP", "image/webp")):
        response = upload(client, encode(LABEL, image_format), content_type)
        assert response.status_code == 200
        url = user_content(openrouter)[1]["image_url"]["url"]  # type: ignore[index]
        assert url.startswith("data:image/jpeg;base64,")


def test_rerun_with_corrected_text_and_photo(
    client: TestClient, openrouter: FakeOpenRouter
) -> None:
    response = upload(
        client, encode(LABEL), ingredients_text="Ingredients: sugar, beef gelatine, E471"
    )

    assert response.status_code == 200
    assert response.json()["used_corrected_text"] is True
    text_part, image_part = user_content(openrouter)
    assert "beef gelatine" in str(text_part["text"])
    assert "authoritative" in str(text_part["text"])
    assert image_part["type"] == "image_url"


def test_rerun_with_text_only(client: TestClient, openrouter: FakeOpenRouter) -> None:
    response = client.post(URL, data={"ingredients_text": "sugar, salt"})

    assert response.status_code == 200
    content = user_content(openrouter)
    assert len(content) == 1
    assert content[0]["type"] == "text"


def test_multilingual_label_preserves_original_text(
    client: TestClient, openrouter: FakeOpenRouter
) -> None:
    arabic = "جيلاتين"
    french = "mono- et diglycérides d'acides gras (E471)"
    openrouter.handler = lambda _r: chat_response(
        valid_analysis(
            detected_language=["Arabic", "French"],
            extracted_ingredients_text=f"المكونات: سكر، {arabic} / Ingrédients : sucre, {french}",
            overall_status="needs_further_investigation",
            ingredients=[
                ingredient(
                    arabic,
                    standardised_name="Gelatine",
                    translation="gelatine",
                    possible_sources=["pork", "animal"],
                    assessment="potential_concern",
                    needs_more_information=True,
                ),
                ingredient(
                    french,
                    standardised_name="Mono- and diglycerides of fatty acids",
                    translation="mono- and diglycerides of fatty acids",
                    e_number="E471",
                    possible_sources=["plant", "animal"],
                    assessment="unknown",
                    needs_more_information=True,
                ),
            ],
        )
    )

    body = upload(client, encode(LABEL)).json()

    assert body["detected_language"] == ["Arabic", "French"]
    assert body["extracted_ingredients_text"].startswith("المكونات")
    gelatine, e471 = body["ingredients"]
    assert gelatine["original_text"] == arabic
    assert gelatine["translation"] == "gelatine"
    assert e471["original_text"] == french
    assert e471["e_number"] == "E471"


# --- Safeguards on the model's verdict -------------------------------------------------------


def test_ambiguous_source_prevents_likely_halal(
    client: TestClient, openrouter: FakeOpenRouter
) -> None:
    openrouter.handler = lambda _r: chat_response(
        valid_analysis(
            overall_status="likely_halal",
            ingredients=[
                ingredient("sugar"),
                ingredient(
                    "E471",
                    possible_sources=["plant", "animal"],
                    assessment="unknown",
                    needs_more_information=True,
                ),
            ],
        )
    )

    body = upload(client, encode(LABEL)).json()

    assert body["overall_status"] == "needs_further_investigation"
    assert "source of at least one ingredient is uncertain" in body["adjustments"][0]


def test_needs_more_information_alone_prevents_likely_halal(
    client: TestClient, openrouter: FakeOpenRouter
) -> None:
    openrouter.handler = lambda _r: chat_response(
        valid_analysis(
            ingredients=[ingredient("natural flavouring", needs_more_information=True)],
        )
    )

    assert upload(client, encode(LABEL)).json()["overall_status"] == "needs_further_investigation"


def test_concern_prevents_likely_halal(client: TestClient, openrouter: FakeOpenRouter) -> None:
    openrouter.handler = lambda _r: chat_response(
        valid_analysis(
            ingredients=[
                ingredient("gelatine", possible_sources=["pork"], assessment="potential_concern")
            ],
        )
    )

    body = upload(client, encode(LABEL)).json()

    assert body["overall_status"] == "potentially_non_halal"
    assert "marked as a concern" in body["adjustments"][0]


def test_prohibited_finding_forces_potentially_non_halal(
    client: TestClient, openrouter: FakeOpenRouter
) -> None:
    openrouter.handler = lambda _r: chat_response(
        valid_analysis(
            overall_status="needs_further_investigation",
            prohibited_findings=[
                {"ingredient": "pork gelatine", "source": "pork", "evidence": "Label says pork."}
            ],
        )
    )

    body = upload(client, encode(LABEL)).json()

    assert body["overall_status"] == "potentially_non_halal"
    assert body["prohibited_findings"][0]["source"] == "pork"
    assert "prohibited source" in body["adjustments"][0]


def test_unreadable_label_is_never_likely_halal(
    client: TestClient, openrouter: FakeOpenRouter
) -> None:
    openrouter.handler = lambda _r: chat_response(
        valid_analysis(
            label_readable=False,
            readability_notes="The text is blurred. Retake the photo closer and in focus.",
            confidence="high",
            ingredients=[],
            extracted_ingredients_text="",
        )
    )

    body = upload(client, encode(LABEL)).json()

    assert body["overall_status"] == "needs_further_investigation"
    assert body["confidence"] == "low"
    assert body["readability_notes"].startswith("The text is blurred")
    assert len(body["adjustments"]) == 2


def test_no_ingredients_is_never_likely_halal(
    client: TestClient, openrouter: FakeOpenRouter
) -> None:
    openrouter.handler = lambda _r: chat_response(
        valid_analysis(ingredients=[], extracted_ingredients_text="")
    )

    assert upload(client, encode(LABEL)).json()["overall_status"] == "needs_further_investigation"


def test_safeguards_never_make_the_result_less_cautious(
    client: TestClient, openrouter: FakeOpenRouter
) -> None:
    openrouter.handler = lambda _r: chat_response(
        valid_analysis(overall_status="potentially_non_halal", confidence="low")
    )

    body = upload(client, encode(LABEL)).json()

    assert body["overall_status"] == "potentially_non_halal"
    assert body["adjustments"] == []


# --- Malformed or incomplete model responses -------------------------------------------------


def test_accepts_json_in_code_fences(client: TestClient, openrouter: FakeOpenRouter) -> None:
    fenced = "```json\n" + json.dumps(valid_analysis()) + "\n```"
    openrouter.handler = lambda _r: chat_response(fenced)

    assert upload(client, encode(LABEL)).status_code == 200


def test_accepts_json_surrounded_by_prose(client: TestClient, openrouter: FakeOpenRouter) -> None:
    wrapped = "Here is the analysis:\n" + json.dumps(valid_analysis()) + "\nHope this helps."
    openrouter.handler = lambda _r: chat_response(wrapped)

    assert upload(client, encode(LABEL)).status_code == 200


def test_normalises_enum_spelling(client: TestClient, openrouter: FakeOpenRouter) -> None:
    openrouter.handler = lambda _r: chat_response(
        valid_analysis(
            overall_status="Likely Halal",
            confidence="HIGH",
            ingredients=[
                ingredient(
                    "whey",
                    assessment="Likely-Permissible",
                    possible_sources=["Animal", "dairy", "animal"],
                )
            ],
        )
    )

    body = upload(client, encode(LABEL)).json()

    assert body["overall_status"] == "likely_halal"
    assert body["confidence"] == "high"
    assert body["ingredients"][0]["assessment"] == "likely_permissible"
    # Unrecognised sources become "unknown"; duplicates are removed.
    assert body["ingredients"][0]["possible_sources"] == ["animal", "unknown"]


@pytest.mark.parametrize(
    "content",
    [
        "I'm sorry, I can't help with that.",
        "{not valid json",
        json.dumps(["a", "list"]),
        json.dumps({k: v for k, v in valid_analysis().items() if k != "overall_status"}),
        json.dumps(valid_analysis(overall_status="halal")),
        json.dumps(valid_analysis(ingredients=[{"original_text": "sugar"}])),
        "   ",
    ],
    ids=[
        "prose",
        "broken-json",
        "array",
        "missing-field",
        "bad-enum",
        "partial-ingredient",
        "blank",
    ],
)
def test_rejects_malformed_model_output(
    client: TestClient, openrouter: FakeOpenRouter, content: str
) -> None:
    openrouter.handler = lambda _r: chat_response(content)

    response = upload(client, encode(LABEL))

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "ai_invalid_response"


def test_rejects_truncated_output(client: TestClient, openrouter: FakeOpenRouter) -> None:
    truncated = json.dumps(valid_analysis())[:200]
    openrouter.handler = lambda _r: chat_response(truncated, finish_reason="length")

    response = upload(client, encode(LABEL))

    assert response.status_code == 502
    assert "cut off" in response.json()["error"]["message"]


@pytest.mark.parametrize(
    "payload",
    [
        {"choices": []},
        {"choices": [{"message": {"content": None, "refusal": "No."}}]},
        {"unexpected": True},
    ],
    ids=["no-choices", "refusal", "no-choices-key"],
)
def test_rejects_incomplete_envelopes(
    client: TestClient, openrouter: FakeOpenRouter, payload: dict[str, object]
) -> None:
    openrouter.handler = lambda _r: httpx.Response(200, json=payload)

    response = upload(client, encode(LABEL))

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "ai_invalid_response"


def test_accepts_content_as_list_of_parts(client: TestClient, openrouter: FakeOpenRouter) -> None:
    text = json.dumps(valid_analysis())
    openrouter.handler = lambda _r: httpx.Response(
        200,
        json={
            "choices": [
                {
                    "finish_reason": "stop",
                    "message": {"content": [{"type": "text", "text": text}]},
                }
            ]
        },
    )

    assert upload(client, encode(LABEL)).status_code == 200


# --- OpenRouter errors -----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("upstream_status", "expected_status", "expected_code"),
    [
        (400, 502, "ai_request_rejected"),
        (401, 503, "ai_not_configured"),
        (402, 503, "ai_unavailable"),
        (403, 503, "ai_not_configured"),
        (404, 503, "ai_unavailable"),
        (408, 504, "ai_timeout"),
        (429, 429, "ai_rate_limited"),
        (500, 503, "ai_unavailable"),
        (502, 503, "ai_unavailable"),
    ],
)
def test_openrouter_http_errors(
    client: TestClient,
    openrouter: FakeOpenRouter,
    upstream_status: int,
    expected_status: int,
    expected_code: str,
) -> None:
    openrouter.handler = lambda _r: httpx.Response(
        upstream_status, json={"error": {"code": upstream_status, "message": "upstream says no"}}
    )

    response = upload(client, encode(LABEL))

    assert response.status_code == expected_status
    assert response.json()["error"]["code"] == expected_code
    # Upstream details are logged, not shown to users.
    assert "upstream says no" not in response.text


def test_error_inside_a_200_response(client: TestClient, openrouter: FakeOpenRouter) -> None:
    openrouter.handler = lambda _r: httpx.Response(
        200, json={"error": {"code": 429, "message": "Provider rate limited"}}
    )

    response = upload(client, encode(LABEL))

    assert response.status_code == 429


def test_non_json_error_page(client: TestClient, openrouter: FakeOpenRouter) -> None:
    openrouter.handler = lambda _r: httpx.Response(503, text="<html>Bad gateway</html>")

    assert upload(client, encode(LABEL)).json()["error"]["code"] == "ai_unavailable"


def test_openrouter_timeout(client: TestClient, openrouter: FakeOpenRouter) -> None:
    def timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out", request=request)

    openrouter.handler = timeout

    response = upload(client, encode(LABEL))

    assert response.status_code == 504
    assert response.json()["error"]["code"] == "ai_timeout"


def test_openrouter_unreachable(client: TestClient, openrouter: FakeOpenRouter) -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    openrouter.handler = refuse

    assert upload(client, encode(LABEL)).json()["error"]["code"] == "ai_unavailable"


# --- Configuration and rate limiting ---------------------------------------------------------


@pytest.mark.parametrize("settings", [{"OPENROUTER_API_KEY": ""}], indirect=True)
def test_missing_api_key(client: TestClient, openrouter: FakeOpenRouter) -> None:
    response = upload(client, encode(LABEL))

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "ai_not_configured"
    assert openrouter.requests == []


@pytest.mark.parametrize("settings", [{"openrouter_structured_outputs": False}], indirect=True)
def test_without_structured_outputs_schema_goes_in_prompt(
    client: TestClient, openrouter: FakeOpenRouter
) -> None:
    upload(client, encode(LABEL))

    body = openrouter.last_body
    assert "response_format" not in body
    assert "JSON schema:" in body["messages"][0]["content"]


@pytest.mark.parametrize("limiter", [SlidingWindowRateLimiter(limit=2)], indirect=True)
def test_rate_limit(client: TestClient, openrouter: FakeOpenRouter) -> None:
    # Invalid requests don't count towards the limit.
    assert upload(client, b"not an image").status_code == 415

    assert upload(client, encode(LABEL)).status_code == 200
    assert upload(client, encode(LABEL)).status_code == 200
    response = upload(client, encode(LABEL))

    assert response.status_code == 429
    assert response.json()["error"]["code"] == "too_many_requests"
    assert len(openrouter.requests) == 2


# --- Upload validation -----------------------------------------------------------------------


@pytest.mark.parametrize("content_type", ["text/plain", "application/pdf", "image/gif"])
def test_rejects_unsupported_content_types(
    client: TestClient, openrouter: FakeOpenRouter, content_type: str
) -> None:
    response = upload(client, encode(LABEL), content_type)

    assert response.status_code == 415
    assert response.json()["error"]["code"] == "unsupported_image_type"
    assert openrouter.requests == []


def test_rejects_files_that_are_not_really_images(client: TestClient) -> None:
    response = upload(client, b"%PDF-1.7 pretending to be a jpeg")

    assert response.status_code == 415


def test_trusts_contents_over_generic_content_type(client: TestClient) -> None:
    assert upload(client, encode(LABEL), "application/octet-stream").status_code == 200


def test_rejects_corrupt_images(client: TestClient) -> None:
    response = upload(client, encode(LABEL)[:200])

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_image"


def test_rejects_tiny_images(client: TestClient) -> None:
    response = upload(client, encode(Image.new("RGB", (40, 40), "white")))

    assert response.status_code == 400
    assert "too small" in response.json()["error"]["message"]


def test_rejects_large_uploads(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "max_upload_bytes", 1024)

    response = upload(client, encode(LABEL))

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "image_too_large"


def test_rejects_empty_files(client: TestClient) -> None:
    response = upload(client, b"")

    assert response.status_code == 400
    assert response.json()["error"]["message"] == "The uploaded file is empty."


def test_requires_a_photo_or_text(client: TestClient, openrouter: FakeOpenRouter) -> None:
    response = client.post(URL, data={"ingredients_text": "   "})

    assert response.status_code == 400
    assert response.json()["error"]["message"] == "Please add a photo of the ingredients label."
    assert openrouter.requests == []


def test_rejects_overly_long_text(client: TestClient) -> None:
    response = client.post(URL, data={"ingredients_text": "x" * 5001})

    assert response.status_code == 400
    assert "too long" in response.json()["error"]["message"]
