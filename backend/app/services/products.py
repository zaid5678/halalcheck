"""Product data source interface.

Product lookups (search and barcode) are not implemented yet: another part of the project will
provide a data source. To plug one in, implement ``ProductLookup`` and return it from
``get_product_lookup``. The API routes, validation and response models are already in place.
"""

from typing import Protocol

from app.errors import AppError
from app.models.product import Product, SearchResponse


class ProductLookupUnavailableError(AppError):
    code = "product_lookup_unavailable"
    status_code = 501
    message = "Product lookup isn't available yet."


class ProductNotFoundError(AppError):
    code = "not_found"
    status_code = 404
    message = "No product with this barcode was found."


class ProductLookup(Protocol):
    async def search(self, query: str, page: int) -> SearchResponse:
        """Search by product name or brand. ``query`` is already sanitised."""
        ...

    async def get_product(self, barcode: str) -> Product:
        """Return one product, or raise ``ProductNotFoundError``. ``barcode`` is validated."""
        ...


class UnavailableProductLookup:
    """Placeholder used until a real product data source is connected."""

    async def search(self, query: str, page: int) -> SearchResponse:
        raise ProductLookupUnavailableError()

    async def get_product(self, barcode: str) -> Product:
        raise ProductLookupUnavailableError()


def get_product_lookup() -> ProductLookup:
    return UnavailableProductLookup()
