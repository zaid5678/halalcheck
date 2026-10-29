from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.models.product import ErrorResponse, Product, SearchResponse
from app.services.products import ProductLookup, get_product_lookup
from app.validation import normalise_barcode, normalise_query

router = APIRouter(prefix="/api/products", tags=["products"])

_ERRORS: dict[int | str, dict[str, object]] = {
    400: {"model": ErrorResponse, "description": "Invalid input"},
    501: {"model": ErrorResponse, "description": "No product data source is connected yet"},
}

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
