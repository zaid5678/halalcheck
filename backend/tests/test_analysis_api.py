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
    concern,
    encode,
    ingredient,
    make_label,
    valid_analysis,
    valid_reading,
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
            detected_languages=["Arabic", "French"],
            extracted_ingredients_text=f"المكونات: سكر، {arabic} / Ingrédients : sucre, {french}",
            overall_status="needs_further_investigation",
            ingredients=[
                ingredient(
                    arabic,
                    translated_name="gelatine",
                    standardised_identity="Gelatine",
                    alternative_names=["gelatin"],
                    possible_sources=["pork", "animal"],
                    assessment="potential_concern",
                    needs_more_information=True,
                ),
                ingredient(
                    french,
                    translated_name="mono- and diglycerides of fatty acids",
                    standardised_identity="Mono- and diglycerides of fatty acids",
                    e_number="E471",
                    possible_sources=["plant", "animal"],
                    assessment="unknown",
                    needs_more_information=True,
                ),
            ],
            identified_concerns=[concern(arabic, "swine"), concern(french, "swine")],
        )
    )

    body = upload(client, encode(LABEL)).json()

    assert body["detected_languages"] == ["Arabic", "French"]
    assert body["extracted_ingredients_text"].startswith("المكونات")
    gelatine, e471 = body["ingredients"]
    assert gelatine["original_text"] == arabic
    assert gelatine["translated_name"] == "gelatine"
    assert e471["original_text"] == french
    assert e471["e_number"] == "E471"


# --- Knowledge base cross-check (independent of the label's language) ------------------------


def test_knowledge_base_matches_via_english_interpretation(
    client: TestClient, openrouter: FakeOpenRouter
) -> None:
    """An Arabic name doesn't escape the knowledge base: its English interpretation is matched."""
    openrouter.handler = lambda _r: chat_response(
        valid_analysis(
            detected_languages=["Arabic"],
            ingredients=[
                ingredient("سكر", translated_name="sugar"),
                # The model wrongly calls it permissible; the knowledge base disagrees.
                ingredient("جيلاتين", translated_name="gelatine", standardised_identity="Gelatine"),
            ],
        )
    )

    body = upload(client, encode(LABEL)).json()

    gelatine = body["ingredients"][1]
    assert gelatine["knowledge_base_match"] == {
        "term": "gelatine",
        "ruling": "doubtful",
        "note": "Usually pork or non-halal beef unless the source is stated",
    }
    assert gelatine["assessment"] == "unknown"
    assert gelatine["needs_more_information"] is True
    assert body["overall_status"] == "needs_further_investigation"
    assert any("knowledge base" in note for note in body["adjustments"])


def test_most_specific_knowledge_base_term_wins(
    client: TestClient, openrouter: FakeOpenRouter
) -> None:
    openrouter.handler = lambda _r: chat_response(
        valid_analysis(
            ingredients=[
                ingredient(
                    "جيلاتين الخنزير",
                    translated_name="pork gelatine",
                    standardised_identity="Gelatine",
                    established_source="pork",
                    possible_sources=["pork"],
                    assessment="potential_concern",
                    evidence_basis="label",
                )
            ],
            identified_concerns=[],
            overall_status="potentially_non_halal",
        )
    )

    body = upload(client, encode(LABEL)).json()

    assert body["ingredients"][0]["knowledge_base_match"]["term"] == "pork gelatine"
    # The knowledge base adds the swine concern the model left out, as a possible concern.
    [added] = body["identified_concerns"]
    assert added["principle_id"] == "swine"
    assert added["concern_type"] == "possible_prohibited_source"
    assert added["verified_prohibited_source"] is False


def test_knowledge_base_never_relaxes_a_concern(
    client: TestClient, openrouter: FakeOpenRouter
) -> None:
    """Flavourings are ruled halal in the knowledge base, but a model concern still stands."""
    openrouter.handler = lambda _r: chat_response(
        valid_analysis(
            overall_status="needs_further_investigation",
            ingredients=[
                ingredient(
                    "arôme",
                    translated_name="flavouring",
                    possible_sources=["plant", "alcohol"],
                    assessment="unknown",
                    needs_more_information=True,
                )
            ],
            identified_concerns=[concern("arôme", "intoxicants")],
        )
    )

    body = upload(client, encode(LABEL)).json()

    assert body["ingredients"][0]["knowledge_base_match"]["ruling"] == "halal"
    assert body["ingredients"][0]["assessment"] == "unknown"
    assert body["overall_status"] == "needs_further_investigation"


# --- Haram only when both questions are answered ---------------------------------------------


def pork_gelatine_analysis(**overrides: object) -> dict[str, object]:
    analysis = valid_analysis(
        detected_languages=["Arabic"],
        overall_status="haram",
        confidence="high",
        ingredients=[
            ingredient("سكر", translated_name="sugar"),
            ingredient(
                "جيلاتين الخنزير",
                translated_name="pork gelatine",
                standardised_identity="Gelatine (porcine)",
                possible_sources=["pork"],
                established_source="pork",
                assessment="potential_concern",
                evidence="The label says جيلاتين الخنزير, 'pork gelatine'.",
                evidence_basis="label",
            ),
        ],
        identified_concerns=[
            concern(
                "جيلاتين الخنزير",
                "swine",
                concern_type="established_prohibited_source",
                source_evidence="The label names the gelatine as pork gelatine.",
                source_evidence_basis="label",
                connection="The gelatine is stated to come from pigs.",
                unresolved_question=None,
            )
        ],
    )
    analysis.update(overrides)
    return analysis


def test_established_pork_source_is_haram_with_specific_reason(
    client: TestClient, openrouter: FakeOpenRouter
) -> None:
    openrouter.handler = lambda _r: chat_response(pork_gelatine_analysis())

    body = upload(client, encode(LABEL)).json()

    assert body["overall_status"] == "haram"
    assert body["adjustments"] == []
    [reason] = body["reason_for_prohibition"]
    assert reason["ingredient_on_packaging"] == "جيلاتين الخنزير"
    assert reason["translated_name"] == "pork gelatine"
    assert reason["standardised_name"] == "Gelatine (porcine)"
    assert reason["source"] == "pork"
    assert reason["source_evidence_basis"] == "label"
    assert reason["principle_id"] == "swine"
    assert reason["why_prohibited"].startswith("The Qur'an explicitly prohibits the flesh of swine")
    assert reason["connection"] == "The gelatine is stated to come from pigs."
    assert reason["evidence_ids"] == [
        "quran-2-173",
        "quran-5-3",
        "quran-6-145",
        "hadith-bukhari-2236",
    ]
    assert reason["has_verified_hadith"] is True
    assert any("istihalah" in q for q in reason["qualifications"])


def test_haram_result_cites_verified_library_evidence(
    client: TestClient, openrouter: FakeOpenRouter
) -> None:
    openrouter.handler = lambda _r: chat_response(pork_gelatine_analysis())

    body = upload(client, encode(LABEL)).json()

    evidence = {item["id"]: item for item in body["islamic_evidence"]}
    quran = evidence["quran-2-173"]
    assert quran["reference"] == "Qur'an 2:173"
    assert quran["url"] == "https://quran.com/2/173"
    assert quran["translation_source"] == "Saheeh International"
    assert "the flesh of swine" in quran["translation"]
    assert "لَحْمَ ٱلْخِنزِيرِ" in quran["arabic_text"]
    assert quran["principle_ids"] == ["swine"]
    hadith = evidence["hadith-bukhari-2236"]
    assert hadith["url"] == "https://sunnah.com/bukhari:2236"
    assert hadith["authenticity"]["grade"] == "Sahih"
    assert hadith["excerpt"] is True
    assert any("does not mention modern food additives" in note for note in hadith["notes"])


def test_unknown_gelatine_is_never_haram(client: TestClient, openrouter: FakeOpenRouter) -> None:
    """The model claims haram, but the label does not establish a pig source."""
    openrouter.handler = lambda _r: chat_response(
        pork_gelatine_analysis(
            ingredients=[
                ingredient(
                    "gélatine",
                    translated_name="gelatine",
                    possible_sources=["pork", "animal"],
                    established_source=None,
                    assessment="potential_concern",
                    needs_more_information=True,
                )
            ],
            identified_concerns=[
                concern(
                    "gélatine",
                    "swine",
                    concern_type="established_prohibited_source",
                    source_evidence="Gelatine is commonly made from pork.",
                    source_evidence_basis="general_knowledge",
                )
            ],
        )
    )

    body = upload(client, encode(LABEL)).json()

    assert body["overall_status"] == "potentially_non_halal"
    assert body["reason_for_prohibition"] == []
    assert body["identified_concerns"][0]["verified_prohibited_source"] is False
    assert "not supported" in body["adjustments"][0]


def test_chemical_name_alone_does_not_establish_source(
    client: TestClient, openrouter: FakeOpenRouter
) -> None:
    """A label-basis claim still needs the ingredient's source to be established."""
    openrouter.handler = lambda _r: chat_response(
        pork_gelatine_analysis(
            ingredients=[
                ingredient(
                    "glycerol monostearate",
                    standardised_identity="Mono- and diglycerides of fatty acids",
                    e_number="E471",
                    possible_sources=["plant", "animal", "pork"],
                    established_source=None,
                    assessment="potential_concern",
                )
            ],
            identified_concerns=[
                concern(
                    "glycerol monostearate",
                    "swine",
                    concern_type="established_prohibited_source",
                    source_evidence_basis="label",
                )
            ],
        )
    )

    body = upload(client, encode(LABEL)).json()

    assert body["overall_status"] == "potentially_non_halal"
    assert (
        body["ingredients"][0]["knowledge_base_match"]["term"]
        == "mono- and diglycerides of fatty acids"
    )


def test_stated_beef_does_not_establish_carrion(
    client: TestClient, openrouter: FakeOpenRouter
) -> None:
    """'Beef gelatine' establishes the animal, not that it wasn't slaughtered Islamically."""
    openrouter.handler = lambda _r: chat_response(
        pork_gelatine_analysis(
            ingredients=[
                ingredient(
                    "beef gelatine",
                    possible_sources=["animal"],
                    established_source="animal",
                    assessment="potential_concern",
                    needs_more_information=True,
                    evidence_basis="label",
                )
            ],
            identified_concerns=[
                concern(
                    "beef gelatine",
                    "carrion",
                    concern_type="established_prohibited_source",
                    source_evidence_basis="label",
                )
            ],
        )
    )

    assert upload(client, encode(LABEL)).json()["overall_status"] == "potentially_non_halal"


def test_disputed_ingredient_is_not_haram(client: TestClient, openrouter: FakeOpenRouter) -> None:
    openrouter.handler = lambda _r: chat_response(
        pork_gelatine_analysis(
            ingredients=[
                ingredient(
                    "carmin (E120)",
                    translated_name="carmine",
                    e_number="E120",
                    possible_sources=["insect"],
                    established_source="insect",
                    assessment="potential_concern",
                    evidence_basis="label",
                )
            ],
            identified_concerns=[
                concern(
                    "carmin (E120)",
                    "insects",
                    concern_type="disputed_ingredient",
                    source_evidence_basis="label",
                )
            ],
        )
    )

    body = upload(client, encode(LABEL)).json()

    assert body["overall_status"] == "potentially_non_halal"
    [qualification] = body["scholarly_qualifications"]
    assert qualification["principle_id"] == "insects"
    assert qualification["category"] == "disputed"
    assert any("Maliki" in note for note in qualification["notes"])


def test_label_established_prohibited_source_upgrades_to_haram(
    client: TestClient, openrouter: FakeOpenRouter
) -> None:
    openrouter.handler = lambda _r: chat_response(
        pork_gelatine_analysis(overall_status="potentially_non_halal")
    )

    body = upload(client, encode(LABEL)).json()

    assert body["overall_status"] == "haram"
    assert "label establishes" in body["adjustments"][0]


def test_principle_outside_the_library_is_removed(
    client: TestClient, openrouter: FakeOpenRouter
) -> None:
    """The model can't cite anything outside the curated library."""
    openrouter.handler = lambda _r: chat_response(
        valid_analysis(
            overall_status="potentially_non_halal",
            identified_concerns=[concern("sugar", "invented_hadith_about_sugar")],
        )
    )

    body = upload(client, encode(LABEL)).json()

    assert body["identified_concerns"] == []
    assert body["islamic_evidence"] == []
    assert "not in HalalCheck’s verified evidence library was removed" in body["adjustments"][0]


def test_unknown_sources_cite_doubtful_matters(
    client: TestClient, openrouter: FakeOpenRouter
) -> None:
    openrouter.handler = lambda _r: chat_response(
        valid_analysis(
            overall_status="needs_further_investigation",
            ingredients=[ingredient("enzymes", assessment="unknown", needs_more_information=True)],
            unresolved_questions=["Are the enzymes microbial or animal-derived?"],
        )
    )

    body = upload(client, encode(LABEL)).json()

    assert [e["id"] for e in body["islamic_evidence"]] == [
        "hadith-bukhari-52",
        "hadith-muslim-1599a",
    ]
    assert body["unresolved_questions"] == ["Are the enzymes microbial or animal-derived?"]
    [source] = body["ingredient_source_evidence"]
    assert source["ingredient"] == "enzymes"
    assert source["established_source"] is None


# --- Other safeguards ------------------------------------------------------------------------


def test_concern_prevents_likely_halal(client: TestClient, openrouter: FakeOpenRouter) -> None:
    openrouter.handler = lambda _r: chat_response(
        valid_analysis(
            ingredients=[
                ingredient(
                    "emulsifier", possible_sources=["animal"], assessment="potential_concern"
                )
            ],
        )
    )

    body = upload(client, encode(LABEL)).json()

    assert body["overall_status"] == "potentially_non_halal"
    assert "identified as a concern" in body["adjustments"][0]


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


# --- Step 1: reading the label ---------------------------------------------------------------


def test_reads_a_label_with_the_fast_model(client: TestClient, openrouter: FakeOpenRouter) -> None:
    openrouter.handler = lambda _r: chat_response(valid_reading())

    response = client.post(
        "/api/ingredients/read", files={"image": ("label.jpg", encode(LABEL), "image/jpeg")}
    )

    assert response.status_code == 200
    body = response.json()
    assert body["model"] == "test/fast-reader"
    assert body["detected_languages"] == ["Arabic"]
    assert body["ingredients_text"] == "المكونات: سكر، جيلاتين"
    uncertain = body["ingredients"][1]
    assert uncertain["original_text"] == "جيلاتين"
    assert uncertain["reading_uncertain"] is True
    sent = openrouter.last_body
    assert sent["model"] == "test/fast-reader"
    assert sent["response_format"]["json_schema"]["name"] == "label_reading"
    assert "do not assess halal status" in sent["messages"][0]["content"]


def test_reading_requires_an_image(client: TestClient) -> None:
    assert client.post("/api/ingredients/read").status_code == 400


def test_reading_rejects_malformed_output(client: TestClient, openrouter: FakeOpenRouter) -> None:
    openrouter.handler = lambda _r: chat_response({"ingredients": "not a list"})

    response = client.post(
        "/api/ingredients/read", files={"image": ("label.jpg", encode(LABEL), "image/jpeg")}
    )

    assert response.status_code == 502


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
                    "water",
                    assessment="Likely-Permissible",
                    possible_sources=["Mineral", "liquid", "mineral"],
                    established_source="Mineral",
                )
            ],
        )
    )

    body = upload(client, encode(LABEL)).json()

    assert body["overall_status"] == "likely_halal"
    assert body["confidence"] == "high"
    assert body["ingredients"][0]["assessment"] == "likely_permissible"
    # Unrecognised sources become "unknown"; duplicates are removed.
    assert body["ingredients"][0]["possible_sources"] == ["mineral", "unknown"]
    assert body["ingredients"][0]["established_source"] == "mineral"


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
