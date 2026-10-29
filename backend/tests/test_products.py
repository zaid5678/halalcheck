import pytest
from fastapi.testclient import TestClient


def test_health_reports_ai_status(client: TestClient) -> None:
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert "ai_configured" in response.json()


@pytest.mark.parametrize("barcode", ["abc", "1234", "123456789012345"])
def test_barcode_input_is_still_validated(client: TestClient, barcode: str) -> None:
    response = client.get(f"/api/products/barcode/{barcode}")

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request"


@pytest.mark.parametrize("query", ["", "a", "**", "x" * 101])
def test_search_input_is_still_validated(client: TestClient, query: str) -> None:
    response = client.get("/api/products/search", params={"q": query})

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request"
