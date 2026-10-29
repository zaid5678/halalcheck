from collections.abc import Callable, Iterator

import httpx
import pytest
from fastapi.testclient import TestClient

from app.api.products import get_product_lookup
from app.config import Settings
from app.main import app
from app.services.open_food_facts import OpenFoodFactsClient, build_http_client

Handler = Callable[[httpx.Request], httpx.Response]


class FakeUpstream:
    """Routes outgoing Open Food Facts requests to per-test handlers, keyed by host + path."""

    def __init__(self) -> None:
        self.routes: dict[str, Handler] = {}
        self.requests: list[httpx.Request] = []

    def on(self, url: str, handler: Handler) -> None:
        parsed = httpx.URL(url)
        self.routes[f"{parsed.host}{parsed.path}"] = handler

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        handler = self.routes.get(f"{request.url.host}{request.url.path}")
        if handler is None:
            raise AssertionError(f"Unexpected upstream request: {request.url}")
        return handler(request)


@pytest.fixture
def settings() -> Settings:
    return Settings(search_page_size=24)


@pytest.fixture
def upstream() -> FakeUpstream:
    return FakeUpstream()


@pytest.fixture
def client(upstream: FakeUpstream, settings: Settings) -> Iterator[TestClient]:
    http = build_http_client(settings, transport=httpx.MockTransport(upstream))
    app.dependency_overrides[get_product_lookup] = lambda: OpenFoodFactsClient(http, settings)
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def json_response(data: object, status_code: int = 200) -> Handler:
    return lambda _request: httpx.Response(status_code, json=data)
