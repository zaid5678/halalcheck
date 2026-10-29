"""Product data source interface.

Open Food Facts is the current data source. To swap it, implement ``ProductLookup`` and return
it from ``get_product_lookup`` in ``app.api.products``.
"""

from typing import Protocol

from app.errors import AppError
from app.models.product import Product, SearchResponse


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
