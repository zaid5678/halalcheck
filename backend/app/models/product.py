"""Public API models. These are deliberately small: only what the frontend needs."""

from pydantic import BaseModel, Field


class ProductSummary(BaseModel):
    """A product as shown in a list of search results."""

    barcode: str = Field(description="Barcode as a string; leading zeros are preserved.")
    name: str | None = None
    brands: list[str] = Field(default_factory=list)
    image_url: str | None = None


class Product(ProductSummary):
    """Full product details for a single barcode."""

    ingredients_text: str | None = None
    categories: list[str] = Field(default_factory=list)
    countries: list[str] = Field(default_factory=list)
    labels: list[str] = Field(
        default_factory=list, description="All labels exactly as recorded on Open Food Facts."
    )
    halal_labels: list[str] = Field(
        default_factory=list,
        description=(
            "Labels that mention halal or a halal certifier, as recorded by Open Food Facts "
            "contributors. Empty means no information, not a negative result."
        ),
    )
    source_url: str = Field(description="Link to the product's Open Food Facts page.")


class SearchResponse(BaseModel):
    query: str
    page: int
    page_size: int
    total: int
    products: list[ProductSummary]


class ErrorDetail(BaseModel):
    code: str = Field(
        description=(
            "Machine-readable error code: invalid_request, not_found, upstream_timeout, "
            "upstream_unavailable, upstream_rate_limited, upstream_invalid_response."
        )
    )
    message: str


class ErrorResponse(BaseModel):
    error: ErrorDetail


class HealthResponse(BaseModel):
    status: str = "ok"
