"""Client for the Open Food Facts APIs, mapping raw responses into HalalCheck models.

Open Food Facts data is crowd-sourced and frequently incomplete, so every field is treated as
optional and nothing is inferred when it is missing.
"""

import logging
import re
import unicodedata
from typing import Any

import httpx

from app.config import Settings
from app.models.product import Product, ProductSummary, SearchResponse

logger = logging.getLogger(__name__)

PRODUCT_FIELDS = (
    "code",
    "product_name",
    "product_name_en",
    "generic_name",
    "generic_name_en",
    "brands",
    "image_front_url",
    "image_url",
    "ingredients_text",
    "ingredients_text_en",
    "categories",
    "countries",
    "labels",
    "labels_tags",
)

SUMMARY_FIELDS = (
    "code",
    "product_name",
    "product_name_en",
    "generic_name",
    "brands",
    "image_front_small_url",
    "image_small_url",
    "image_front_url",
    "image_url",
)

# Words that identify a label as halal-related: "halal" itself, plus certifier names and
# mosque-based certification bodies that appear in Open Food Facts label data.
_HALAL_TOKENS = frozenset(
    {"halal", "mosque", "mosquee", "ifanca", "jakim", "muis", "hmc", "hfa", "sanha", "achahada"}
)
_LANGUAGE_PREFIX = re.compile(r"^[a-z]{2,3}:")


class OpenFoodFactsError(Exception):
    code = "upstream_unavailable"
    status_code = 503
    message = "The product database is currently unavailable. Please try again shortly."

    def __init__(self, message: str | None = None) -> None:
        if message is not None:
            self.message = message
        super().__init__(self.message)


class ProductNotFoundError(OpenFoodFactsError):
    code = "not_found"
    status_code = 404
    message = "No product with this barcode was found in Open Food Facts."


class UpstreamTimeoutError(OpenFoodFactsError):
    code = "upstream_timeout"
    status_code = 504
    message = "The product database took too long to respond. Please try again."


class UpstreamUnavailableError(OpenFoodFactsError):
    pass


class UpstreamRateLimitedError(OpenFoodFactsError):
    code = "upstream_rate_limited"
    status_code = 429
    message = "Too many requests to the product database. Please wait a moment and try again."


class UpstreamInvalidResponseError(OpenFoodFactsError):
    code = "upstream_invalid_response"
    status_code = 502
    message = "The product database returned an unexpected response."


def build_http_client(
    settings: Settings, transport: httpx.AsyncBaseTransport | None = None
) -> httpx.AsyncClient:
    timeout = httpx.Timeout(settings.off_read_timeout, connect=settings.off_connect_timeout)
    return httpx.AsyncClient(
        timeout=timeout,
        headers={"User-Agent": settings.off_user_agent, "Accept": "application/json"},
        follow_redirects=True,
        transport=transport,
    )


class OpenFoodFactsClient:
    def __init__(self, http: httpx.AsyncClient, settings: Settings) -> None:
        self._http = http
        self._settings = settings

    async def get_product(self, barcode: str) -> Product:
        url = f"{self._settings.off_base_url}/api/v2/product/{barcode}.json"
        data = await self._get_json(
            url, {"fields": ",".join(PRODUCT_FIELDS)}, not_found_on_404=True
        )
        product = data.get("product")
        if data.get("status") != 1 or not isinstance(product, dict):
            raise ProductNotFoundError()
        return map_product(product, barcode, self._settings.off_base_url)

    async def search(self, query: str, page: int = 1) -> SearchResponse:
        try:
            return await self._search_service(query, page)
        except (
            UpstreamUnavailableError,
            UpstreamTimeoutError,
            UpstreamInvalidResponseError,
        ) as exc:
            # Rate-limit errors are not retried against the fallback: back off instead.
            logger.warning("Search service failed (%s); falling back to legacy search", exc.code)
        return await self._legacy_search(query, page)

    async def _search_service(self, query: str, page: int) -> SearchResponse:
        page_size = self._settings.search_page_size
        data = await self._get_json(
            self._settings.off_search_url,
            {
                "q": query,
                "page": page,
                "page_size": page_size,
                "fields": ",".join(SUMMARY_FIELDS),
                "langs": "en",
            },
        )
        hits = data.get("hits")
        if not isinstance(hits, list):
            raise UpstreamInvalidResponseError()
        return SearchResponse(
            query=query,
            page=page,
            page_size=page_size,
            total=_as_int(data.get("count"), default=len(hits)),
            products=_map_summaries(hits),
        )

    async def _legacy_search(self, query: str, page: int) -> SearchResponse:
        page_size = self._settings.search_page_size
        data = await self._get_json(
            self._settings.off_legacy_search_url,
            {
                "search_terms": query,
                "search_simple": 1,
                "action": "process",
                "json": 1,
                "page": page,
                "page_size": page_size,
                "fields": ",".join(SUMMARY_FIELDS),
            },
        )
        products = data.get("products")
        if not isinstance(products, list):
            raise UpstreamInvalidResponseError()
        return SearchResponse(
            query=query,
            page=page,
            page_size=page_size,
            total=_as_int(data.get("count"), default=len(products)),
            products=_map_summaries(products),
        )

    async def _get_json(
        self, url: str, params: dict[str, Any], *, not_found_on_404: bool = False
    ) -> dict[str, Any]:
        try:
            response = await self._http.get(url, params=params)
        except httpx.TimeoutException as exc:
            logger.warning("Open Food Facts request timed out: %s", url)
            raise UpstreamTimeoutError() from exc
        except httpx.HTTPError as exc:
            logger.warning("Open Food Facts request failed: %s (%s)", url, type(exc).__name__)
            raise UpstreamUnavailableError() from exc

        status = response.status_code
        if status == 404 and not_found_on_404:
            raise ProductNotFoundError()
        if status == 429:
            logger.warning("Open Food Facts rate limit reached: %s", url)
            raise UpstreamRateLimitedError()
        if status >= 500:
            logger.warning("Open Food Facts returned HTTP %s: %s", status, url)
            raise UpstreamUnavailableError()
        if status >= 400:
            logger.warning("Open Food Facts returned unexpected HTTP %s: %s", status, url)
            raise UpstreamInvalidResponseError()

        try:
            data = response.json()
        except ValueError as exc:
            logger.warning("Open Food Facts returned non-JSON content: %s", url)
            raise UpstreamInvalidResponseError() from exc
        if not isinstance(data, dict):
            raise UpstreamInvalidResponseError()
        return data


def map_product(raw: dict[str, Any], requested_barcode: str, base_url: str) -> Product:
    barcode = _text(raw.get("code")) or requested_barcode
    labels = _merge_labels(_split_list(raw.get("labels")), _split_list(raw.get("labels_tags")))
    return Product(
        barcode=barcode,
        name=_first_text(raw, "product_name", "product_name_en", "generic_name", "generic_name_en"),
        brands=_split_list(raw.get("brands")),
        image_url=_first_text(raw, "image_front_url", "image_url"),
        ingredients_text=_first_text(raw, "ingredients_text", "ingredients_text_en"),
        categories=_split_list(raw.get("categories")),
        countries=_split_list(raw.get("countries")),
        labels=labels,
        halal_labels=[label for label in labels if is_halal_related(label)],
        source_url=f"{base_url}/product/{barcode}",
    )


def map_summary(raw: dict[str, Any]) -> ProductSummary | None:
    barcode = _text(raw.get("code"))
    if barcode is None:
        return None
    return ProductSummary(
        barcode=barcode,
        name=_first_text(raw, "product_name", "product_name_en", "generic_name"),
        brands=_split_list(raw.get("brands")),
        image_url=_first_text(
            raw, "image_front_small_url", "image_small_url", "image_front_url", "image_url"
        ),
    )


def is_halal_related(label: str) -> bool:
    folded = _fold(label)
    if "halal" in folded:
        return True
    return any(token in _HALAL_TOKENS for token in re.split(r"[^a-z0-9]+", folded))


def _merge_labels(display: list[str], from_tags: list[str]) -> list[str]:
    """Prefer the human-written labels, then add any tag the display text left out.

    The free-text ``labels`` field and the ``labels_tags`` taxonomy are maintained separately on
    Open Food Facts, so either can contain a label the other is missing.
    """
    merged = list(display)
    seen = {_label_key(label) for label in display}
    for label in from_tags:
        key = _label_key(label)
        if key not in seen:
            seen.add(key)
            merged.append(label)
    return merged


def _label_key(label: str) -> str:
    return re.sub(r"[^a-z0-9]", "", _fold(label))


def _map_summaries(items: list[Any]) -> list[ProductSummary]:
    summaries = (map_summary(item) for item in items if isinstance(item, dict))
    return [summary for summary in summaries if summary is not None]


def _fold(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch)).lower()


def _text(value: Any) -> str | None:
    if isinstance(value, str):
        return value.strip() or None
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    return None


def _first_text(raw: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = _text(raw.get(key))
        if value:
            return value
    return None


def _split_list(value: Any) -> list[str]:
    """Turn a comma-separated string or a list of strings into clean display values."""
    if isinstance(value, str):
        items: list[Any] = value.split(",")
    elif isinstance(value, list):
        items = value
    else:
        return []

    result: list[str] = []
    seen: set[str] = set()
    for item in items:
        if not isinstance(item, str):
            continue
        text = item.strip()
        if _LANGUAGE_PREFIX.match(text):
            text = _LANGUAGE_PREFIX.sub("", text)
            # Taxonomy tags look like "united-kingdom"; make them readable.
            if text == text.lower():
                text = text.replace("-", " ").capitalize()
        key = text.casefold()
        if text and key not in seen:
            seen.add(key)
            result.append(text)
    return result


def _as_int(value: Any, *, default: int) -> int:
    if isinstance(value, bool):
        return default
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.isdigit():
        return int(value)
    return default
