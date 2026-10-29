import json
from collections.abc import Iterator

import httpx
import pytest
from fastapi.testclient import TestClient

from app.api import halal
from app.api.products import get_off_client
from app.config import Settings
from app.main import app
from app.services.llm import LLMClient
from app.services.open_food_facts import OpenFoodFactsClient, build_http_client
from tests.conftest import FakeUpstream, Handler, json_response

PRODUCT_URL = "https://world.openfoodfacts.org/api/v2/product/{}.json"
LLM_URL = "https://openrouter.ai/api/v1/chat/completions"
BARCODE = "5000168001142"
PNG = b"\x89PNG\r\n\x1a\nfake-image"


def off_product(ingredients: str | None) -> Handler:
    product = {"code": BARCODE, "product_name": "Test Biscuits", "ingredients_text": ingredients}
    return json_response({"status": 1, "product": product})


def llm_reply(content: dict[str, object]) -> Handler:
    return json_response({"choices": [{"message": {"content": json.dumps(content)}}]})


def make_client(upstream: FakeUpstream, api_key: str) -> Iterator[TestClient]:
    settings = Settings(openrouter_api_key=api_key)
    http = build_http_client(settings, transport=httpx.MockTransport(upstream))
    app.dependency_overrides[get_off_client] = lambda: OpenFoodFactsClient(http, settings)
    app.dependency_overrides[halal.get_llm_client] = lambda: LLMClient(http, settings)
    halal.verdict_cache.clear()
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture
def client(upstream: FakeUpstream) -> Iterator[TestClient]:
    yield from make_client(upstream, api_key="test-key")


@pytest.fixture
def client_without_key(upstream: FakeUpstream) -> Iterator[TestClient]:
    yield from make_client(upstream, api_key="")


def llm_requests(upstream: FakeUpstream) -> list[httpx.Request]:
    return [r for r in upstream.requests if r.url.host == "openrouter.ai"]


# --- Barcode --------------------------------------------------------------------------------


def test_haram_from_rules_skips_llm(client: TestClient, upstream: FakeUpstream) -> None:
    upstream.on(PRODUCT_URL.format(BARCODE), off_product("Wheat flour, Pork fat, Salt"))

    response = client.get(f"/api/halal/barcode/{BARCODE}")

    assert response.status_code == 200
    body = response.json()
    assert body["verdict"] == "haram"
    assert body["reasons"] == [
        {"ingredient": "Pork fat", "ruling": "haram", "note": "Pork or pork-derived"}
    ]
    assert body["product"]["name"] == "Test Biscuits"
    assert llm_requests(upstream) == []


def test_llm_adds_concerns_rules_missed(client: TestClient, upstream: FakeUpstream) -> None:
    upstream.on(PRODUCT_URL.format(BARCODE), off_product("Sugar, Chorizo"))
    upstream.on(
        LLM_URL,
        llm_reply(
            {
                "ingredients_text": None,
                "reasons": [{"ingredient": "Chorizo", "ruling": "haram", "note": "Usually pork"}],
            }
        ),
    )

    body = client.get(f"/api/halal/barcode/{BARCODE}").json()

    assert body["verdict"] == "haram"
    assert body["ai_checked"] is True
    sent = json.loads(llm_requests(upstream)[0].content)
    assert sent["model"] == "openai/gpt-6.1-terra"
    assert "Sugar, Chorizo" in json.dumps(sent["messages"])
    assert llm_requests(upstream)[0].headers["authorization"] == "Bearer test-key"


def test_llm_cannot_loosen_a_ruling(client: TestClient, upstream: FakeUpstream) -> None:
    upstream.on(PRODUCT_URL.format(BARCODE), off_product("Sugar, Gelatine"))
    upstream.on(
        LLM_URL,
        llm_reply({"reasons": [{"ingredient": "Gelatine", "ruling": "halal", "note": "fine"}]}),
    )

    body = client.get(f"/api/halal/barcode/{BARCODE}").json()

    assert body["verdict"] == "doubtful"
    assert [r["ruling"] for r in body["reasons"]] == ["doubtful"]


def test_llm_does_not_repeat_rule_findings(client: TestClient, upstream: FakeUpstream) -> None:
    upstream.on(PRODUCT_URL.format(BARCODE), off_product("Sugar, Dried Whey (Milk), E476"))
    upstream.on(
        LLM_URL,
        llm_reply(
            {
                "reasons": [
                    {"ingredient": "Dried Whey (Milk)", "ruling": "doubtful", "note": "Rennet"},
                    {"ingredient": "E476", "ruling": "doubtful", "note": "Glycerol source"},
                ]
            }
        ),
    )

    body = client.get(f"/api/halal/barcode/{BARCODE}").json()

    assert [r["ingredient"] for r in body["reasons"]] == ["Whey", "E476"]


def test_llm_failure_falls_back_to_rules(client: TestClient, upstream: FakeUpstream) -> None:
    upstream.on(PRODUCT_URL.format(BARCODE), off_product("Sugar, Salt"))
    upstream.on(LLM_URL, json_response({"error": "boom"}, status_code=500))

    body = client.get(f"/api/halal/barcode/{BARCODE}").json()

    assert body["verdict"] == "halal"
    assert body["ai_checked"] is False


def test_missing_ingredients_is_doubtful(client: TestClient, upstream: FakeUpstream) -> None:
    upstream.on(PRODUCT_URL.format(BARCODE), off_product(None))

    body = client.get(f"/api/halal/barcode/{BARCODE}").json()

    assert body["verdict"] == "doubtful"
    assert body["reasons"][0]["note"] == "Ingredients are not available for this product"
    assert llm_requests(upstream) == []


def test_unknown_barcode_is_404(client: TestClient, upstream: FakeUpstream) -> None:
    upstream.on(PRODUCT_URL.format(BARCODE), json_response({"status": 0}))

    response = client.get(f"/api/halal/barcode/{BARCODE}")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_verdicts_are_cached(client: TestClient, upstream: FakeUpstream) -> None:
    upstream.on(PRODUCT_URL.format(BARCODE), off_product("Sugar, Salt"))
    upstream.on(LLM_URL, llm_reply({"reasons": []}))

    first = client.get(f"/api/halal/barcode/{BARCODE}").json()
    second = client.get(f"/api/halal/barcode/{BARCODE}").json()

    assert first == second
    assert len(upstream.requests) == 2  # one product lookup + one LLM call


# --- Photo ----------------------------------------------------------------------------------


def post_photo(
    client: TestClient, data: bytes = PNG, content_type: str = "image/png"
) -> httpx.Response:
    return client.post("/api/halal/photo", files={"image": ("label.png", data, content_type)})


def test_photo_is_read_and_judged(client: TestClient, upstream: FakeUpstream) -> None:
    upstream.on(
        LLM_URL, llm_reply({"ingredients_text": "Sugar, Beef Gelatine, E120", "reasons": []})
    )

    response = post_photo(client)

    assert response.status_code == 200
    body = response.json()
    assert body["verdict"] == "haram"
    assert body["ingredients_text"] == "Sugar, Beef Gelatine, E120"
    assert body["product"] is None
    assert {r["ingredient"] for r in body["reasons"]} == {"Beef", "Gelatine", "E120"}
    sent = json.dumps(json.loads(llm_requests(upstream)[0].content))
    assert "data:image/png;base64," in sent


def test_unreadable_photo_is_422(client: TestClient, upstream: FakeUpstream) -> None:
    upstream.on(LLM_URL, llm_reply({"ingredients_text": None, "reasons": []}))

    response = post_photo(client)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "unreadable_image"


def test_photo_rejects_non_images(client: TestClient) -> None:
    response = post_photo(client, b"hello", "text/plain")

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request"


def test_photo_rejects_large_files(client: TestClient) -> None:
    response = post_photo(client, b"x" * (5 * 1024 * 1024 + 1))

    assert response.status_code == 400


def test_photo_needs_llm(client_without_key: TestClient, upstream: FakeUpstream) -> None:
    response = post_photo(client_without_key)

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "llm_unavailable"
    assert upstream.requests == []
