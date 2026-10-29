from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request

from app.config import get_settings
from app.models.product import ErrorResponse, Product, SearchResponse
from app.services.open_food_facts import OpenFoodFactsClient
from app.services.products import ProductLookup
from app.validation import normalise_barcode, normalise_query

router = APIRouter(prefix="/api/products", tags=["products"])

_ERRORS: dict[int | str, dict[str, object]] = {
    400: {"model": ErrorResponse, "description": "Invalid input"},
    429: {"model": ErrorResponse, "description": "Open Food Facts rate limit reached"},
    502: {"model": ErrorResponse, "description": "Malformed response from Open Food Facts"},
    503: {"model": ErrorResponse, "description": "Open Food Facts unavailable"},
    504: {"model": ErrorResponse, "description": "Open Food Facts timed out"},
}


def get_product_lookup(request: Request) -> ProductLookup:
    return OpenFoodFactsClient(request.app.state.http_client, get_settings())


Lookup = Annotated[ProductLookup, Depends(get_product_lookup)]


@router.get("/search", response_model=SearchResponse, responses=_ERRORS)
async def search_products(
    lookup: Lookup,
    q: Annotated[str, Query(max_length=200, description="Product name or brand")],
    page: Annotated[int, Query(ge=1, le=100)] = 1,
) -> SearchResponse:
    return await lookup.search(normalise_query(q), page)


@router.get(
    "/barcode/{barcode}",
    response_model=Product,
    responses={**_ERRORS, 404: {"model": ErrorResponse, "description": "Product not found"}},
)
async def get_product_by_barcode(lookup: Lookup, barcode: str) -> Product:
    return await lookup.get_product(normalise_barcode(barcode))
