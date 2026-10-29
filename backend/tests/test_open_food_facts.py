from collections.abc import Iterator

import httpx
import pytest
from fastapi.testclient import TestClient

from app.api.products import get_product_lookup
from app.config import Settings
from app.main import app
from app.services.open_food_facts import OpenFoodFactsClient, build_http_client
from tests.conftest import FakeUpstream, json_response


@pytest.fixture
def client(upstream: FakeUpstream, settings: Settings) -> Iterator[TestClient]:
    http = build_http_client(settings, transport=httpx.MockTransport(upstream))
    app.dependency_overrides[get_product_lookup] = lambda: OpenFoodFactsClient(http, settings)
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


PRODUCT_URL = "https://world.openfoodfacts.org/api/v2/product/{}.json"
SEARCH_URL = "https://search.openfoodfacts.org/search"
LEGACY_SEARCH_URL = "https://world.openfoodfacts.org/cgi/search.pl"

FULL_PRODUCT = {
    "code": "3436598133214",
    "status": 1,
    "status_verbose": "product found",
    "product": {
        "code": "3436598133214",
        "product_name": "Taboulé au poulet",
        "brands": "Oriental Viandes, Isla Délice",
        "image_front_url": "https://images.openfoodfacts.org/front.jpg",
        "ingredients_text": "semoule de blé, poulet, tomates",
        "categories": "Plats préparés, en:salads",
        "countries": "France, en:united-kingdom",
        "labels": "Halal, Contrôle de la mosquée d'Évry-Courcouronnes, Point Vert",
        "labels_tags": ["en:halal", "fr:controle-de-la-mosquee-d-evry-courcouronnes"],
    },
}


# --- Barcode lookup -------------------------------------------------------------------------


def test_barcode_lookup_maps_product(client: TestClient, upstream: FakeUpstream) -> None:
    upstream.on(PRODUCT_URL.format("3436598133214"), json_response(FULL_PRODUCT))

    response = client.get("/api/products/barcode/3436598133214")

    assert response.status_code == 200
    assert response.json() == {
        "barcode": "3436598133214",
        "name": "Taboulé au poulet",
        "brands": ["Oriental Viandes", "Isla Délice"],
        "image_url": "https://images.openfoodfacts.org/front.jpg",
        "ingredients_text": "semoule de blé, poulet, tomates",
        "categories": ["Plats préparés", "Salads"],
        "countries": ["France", "United kingdom"],
        "labels": ["Halal", "Contrôle de la mosquée d'Évry-Courcouronnes", "Point Vert"],
        "halal_labels": ["Halal", "Contrôle de la mosquée d'Évry-Courcouronnes"],
        "source_url": "https://world.openfoodfacts.org/product/3436598133214",
    }
    sent = upstream.requests[0]
    assert sent.headers["user-agent"].startswith("HalalCheck/")
    assert "ingredients_text" in sent.url.params["fields"]


def test_barcode_lookup_preserves_leading_zeros(client: TestClient, upstream: FakeUpstream) -> None:
    upstream.on(
        PRODUCT_URL.format("0009800800049"),
        json_response({"status": 1, "product": {"code": "0009800800049"}}),
    )

    response = client.get("/api/products/barcode/0009800800049")

    assert response.status_code == 200
    assert response.json()["barcode"] == "0009800800049"
    assert upstream.requests[0].url.path == "/api/v2/product/0009800800049.json"


def test_barcode_lookup_handles_missing_fields(client: TestClient, upstream: FakeUpstream) -> None:
    upstream.on(
        PRODUCT_URL.format("12345678"),
        json_response({"status": 1, "product": {"brands": "", "labels": None, "categories": 7}}),
    )

    response = client.get("/api/products/barcode/12345678")

    assert response.status_code == 200
    body = response.json()
    assert body["barcode"] == "12345678"
    assert body["name"] is None
    assert body["image_url"] is None
    assert body["ingredients_text"] is None
    assert body["brands"] == []
    assert body["categories"] == []
    assert body["labels"] == []
    assert body["halal_labels"] == []


def test_barcode_lookup_falls_back_to_label_tags(
    client: TestClient, upstream: FakeUpstream
) -> None:
    upstream.on(
        PRODUCT_URL.format("12345678"),
        json_response({"status": 1, "product": {"labels_tags": ["en:halal", "en:organic"]}}),
    )

    body = client.get("/api/products/barcode/12345678").json()

    assert body["labels"] == ["Halal", "Organic"]
    assert body["halal_labels"] == ["Halal"]


def test_barcode_lookup_merges_tags_missing_from_label_text(
    client: TestClient, upstream: FakeUpstream
) -> None:
    upstream.on(
        PRODUCT_URL.format("12345678"),
        json_response(
            {
                "status": 1,
                "product": {
                    "labels": "Contrôle de la mosquée d'Évry",
                    "labels_tags": ["en:halal", "fr:controle-de-la-mosquee-d-evry"],
                },
            }
        ),
    )

    body = client.get("/api/products/barcode/12345678").json()

    assert body["labels"] == ["Contrôle de la mosquée d'Évry", "Halal"]
    assert body["halal_labels"] == ["Contrôle de la mosquée d'Évry", "Halal"]


def test_barcode_not_found_via_404(client: TestClient, upstream: FakeUpstream) -> None:
    upstream.on(
        PRODUCT_URL.format("5000000000017"),
        json_response({"status": 0, "status_verbose": "product not found"}, status_code=404),
    )

    response = client.get("/api/products/barcode/5000000000017")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_barcode_not_found_via_status_zero(client: TestClient, upstream: FakeUpstream) -> None:
    upstream.on(
        PRODUCT_URL.format("00000000"),
        json_response({"status": 0, "status_verbose": "no code or invalid code"}),
    )

    response = client.get("/api/products/barcode/00000000")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


@pytest.mark.parametrize("barcode", ["abc", "1234", "123456789012345", "12345abc", "12.34567"])
def test_barcode_lookup_rejects_invalid_input(
    client: TestClient, upstream: FakeUpstream, barcode: str
) -> None:
    response = client.get(f"/api/products/barcode/{barcode}")

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request"
    assert upstream.requests == []


def test_barcode_lookup_timeout(client: TestClient, upstream: FakeUpstream) -> None:
    def timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out", request=request)

    upstream.on(PRODUCT_URL.format("12345678"), timeout)

    response = client.get("/api/products/barcode/12345678")

    assert response.status_code == 504
    assert response.json()["error"]["code"] == "upstream_timeout"


def test_barcode_lookup_connection_error(client: TestClient, upstream: FakeUpstream) -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    upstream.on(PRODUCT_URL.format("12345678"), refuse)

    response = client.get("/api/products/barcode/12345678")

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "upstream_unavailable"


@pytest.mark.parametrize(
    ("status_code", "expected_status", "expected_code"),
    [
        (429, 429, "upstream_rate_limited"),
        (500, 503, "upstream_unavailable"),
        (503, 503, "upstream_unavailable"),
        (400, 502, "upstream_invalid_response"),
    ],
)
def test_barcode_lookup_upstream_http_errors(
    client: TestClient,
    upstream: FakeUpstream,
    status_code: int,
    expected_status: int,
    expected_code: str,
) -> None:
    upstream.on(PRODUCT_URL.format("12345678"), json_response({}, status_code=status_code))

    response = client.get("/api/products/barcode/12345678")

    assert response.status_code == expected_status
    assert response.json()["error"]["code"] == expected_code


@pytest.mark.parametrize(
    "handler",
    [
        lambda _r: httpx.Response(200, text="<!DOCTYPE html><html>maintenance</html>"),
        lambda _r: httpx.Response(200, json=["not", "an", "object"]),
    ],
    ids=["html", "json-array"],
)
def test_barcode_lookup_malformed_response(
    client: TestClient, upstream: FakeUpstream, handler: object
) -> None:
    upstream.on(PRODUCT_URL.format("12345678"), handler)  # type: ignore[arg-type]

    response = client.get("/api/products/barcode/12345678")

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "upstream_invalid_response"


def test_barcode_lookup_product_not_an_object(client: TestClient, upstream: FakeUpstream) -> None:
    upstream.on(PRODUCT_URL.format("12345678"), json_response({"status": 1, "product": "oops"}))

    response = client.get("/api/products/barcode/12345678")

    assert response.status_code == 404


# --- Search ---------------------------------------------------------------------------------


def test_search_returns_mapped_results(client: TestClient, upstream: FakeUpstream) -> None:
    upstream.on(
        SEARCH_URL,
        json_response(
            {
                "count": 316,
                "page": 1,
                "hits": [
                    {
                        "code": "0098008952506",
                        "product_name": "Nutella",
                        "brands": ["Nutella", "Ferrero"],
                        "image_front_small_url": "https://images.openfoodfacts.org/small.jpg",
                    },
                    {"code": "3017624010701", "generic_name": "Hazelnut spread"},
                    {"product_name": "No barcode, skipped"},
                    "not-an-object",
                ],
            }
        ),
    )

    response = client.get("/api/products/search", params={"q": "  Nutella  "})

    assert response.status_code == 200
    assert response.json() == {
        "query": "nutella",
        "page": 1,
        "page_size": 24,
        "total": 316,
        "products": [
            {
                "barcode": "0098008952506",
                "name": "Nutella",
                "brands": ["Nutella", "Ferrero"],
                "image_url": "https://images.openfoodfacts.org/small.jpg",
            },
            {
                "barcode": "3017624010701",
                "name": "Hazelnut spread",
                "brands": [],
                "image_url": None,
            },
        ],
    }
    params = upstream.requests[0].url.params
    assert params["q"] == "nutella"
    assert params["page_size"] == "24"


def test_search_sanitises_query_syntax(client: TestClient, upstream: FakeUpstream) -> None:
    upstream.on(SEARCH_URL, json_response({"count": 0, "hits": []}))

    client.get("/api/products/search", params={"q": 'labels_tags:"en:halal" OR (-milk*)'})

    assert upstream.requests[0].url.params["q"] == "labels_tags en halal or milk"


def test_search_with_no_results(client: TestClient, upstream: FakeUpstream) -> None:
    upstream.on(SEARCH_URL, json_response({"count": 0, "hits": []}))

    response = client.get("/api/products/search", params={"q": "zzzz"})

    assert response.status_code == 200
    assert response.json()["products"] == []
    assert response.json()["total"] == 0


def test_search_passes_page(client: TestClient, upstream: FakeUpstream) -> None:
    upstream.on(SEARCH_URL, json_response({"count": 50, "hits": []}))

    response = client.get("/api/products/search", params={"q": "milk", "page": 2})

    assert response.json()["page"] == 2
    assert upstream.requests[0].url.params["page"] == "2"


def test_search_falls_back_to_legacy_search(client: TestClient, upstream: FakeUpstream) -> None:
    upstream.on(SEARCH_URL, lambda _r: httpx.Response(503, text="<html>unavailable</html>"))
    upstream.on(
        LEGACY_SEARCH_URL,
        json_response(
            {
                "count": "1",
                "products": [
                    {"code": "3017624010701", "product_name": "Nutella", "brands": "Ferrero"}
                ],
            }
        ),
    )

    response = client.get("/api/products/search", params={"q": "nutella"})

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["products"][0]["brands"] == ["Ferrero"]
    assert upstream.requests[1].url.params["search_terms"] == "nutella"


def test_search_both_services_down(client: TestClient, upstream: FakeUpstream) -> None:
    def timeout(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("timed out", request=request)

    upstream.on(SEARCH_URL, timeout)
    upstream.on(LEGACY_SEARCH_URL, lambda _r: httpx.Response(503, text="<html></html>"))

    response = client.get("/api/products/search", params={"q": "nutella"})

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "upstream_unavailable"


def test_search_malformed_responses(client: TestClient, upstream: FakeUpstream) -> None:
    upstream.on(SEARCH_URL, json_response({"hits": "nope"}))
    upstream.on(LEGACY_SEARCH_URL, lambda _r: httpx.Response(200, text="not json"))

    response = client.get("/api/products/search", params={"q": "nutella"})

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "upstream_invalid_response"


def test_search_rate_limited_does_not_retry(client: TestClient, upstream: FakeUpstream) -> None:
    upstream.on(SEARCH_URL, json_response({}, status_code=429))

    response = client.get("/api/products/search", params={"q": "nutella"})

    assert response.status_code == 429
    assert len(upstream.requests) == 1


@pytest.mark.parametrize("query", ["", " ", "a", "**", "x" * 101])
def test_search_rejects_invalid_queries(
    client: TestClient, upstream: FakeUpstream, query: str
) -> None:
    response = client.get("/api/products/search", params={"q": query})

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request"
    assert upstream.requests == []


def test_search_requires_query(client: TestClient) -> None:
    response = client.get("/api/products/search")

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request"


def test_search_rejects_invalid_page(client: TestClient) -> None:
    response = client.get("/api/products/search", params={"q": "milk", "page": 0})

    assert response.status_code == 400
