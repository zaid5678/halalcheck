import logging
from typing import Annotated

from fastapi import APIRouter, Depends, File, Request, UploadFile

from app.api.products import OffClient
from app.config import get_settings
from app.models.halal import HalalVerdict, Reason
from app.models.product import ErrorResponse
from app.services.llm import LLMClient, LLMError, UnreadableImageError
from app.services.rules import check_ingredients, overall_verdict
from app.validation import InvalidInputError, normalise_barcode

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/halal", tags=["halal"])

# Final verdicts by barcode. In-memory, so it resets when the server restarts.
verdict_cache: dict[str, HalalVerdict] = {}
_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
_NO_INGREDIENTS = Reason(
    ingredient="Ingredients",
    ruling="doubtful",
    note="Ingredients are not available for this product",
)


def get_llm_client(request: Request) -> LLMClient:
    return LLMClient(request.app.state.http_client, get_settings())


Llm = Annotated[LLMClient, Depends(get_llm_client)]


def _merge(rule_reasons: list[Reason], llm_reasons: list[Reason]) -> list[Reason]:
    """Rule findings always stand; the LLM can only add concerns the rules missed."""
    seen = [reason.ingredient.lower() for reason in rule_reasons]
    extra = [
        r
        for r in llm_reasons
        if r.ruling != "halal" and not any(term in r.ingredient.lower() for term in seen)
    ]
    return rule_reasons + extra


@router.get(
    "/barcode/{barcode}",
    response_model=HalalVerdict,
    responses={404: {"model": ErrorResponse, "description": "Product not found"}},
)
async def check_barcode(off: OffClient, llm: Llm, barcode: str) -> HalalVerdict:
    code = normalise_barcode(barcode)
    if code in verdict_cache:
        return verdict_cache[code]

    product = await off.get_product(code)
    text = product.ingredients_text
    if not text:
        return HalalVerdict(
            verdict="doubtful",
            reasons=[_NO_INGREDIENTS],
            ingredients_text=None,
            ai_checked=False,
            product=product,
        )

    reasons = check_ingredients(text)
    ai_checked = False
    if overall_verdict(reasons) != "haram":  # haram from the rules is final; skip the LLM
        try:
            reasons = _merge(reasons, (await llm.review(text)).reasons)
            ai_checked = True
        except LLMError:
            logger.info("Returning rules-only verdict for %s", code)

    result = HalalVerdict(
        verdict=overall_verdict(reasons),
        reasons=reasons,
        ingredients_text=text,
        ai_checked=ai_checked,
        product=product,
    )
    if ai_checked or result.verdict == "haram":
        verdict_cache[code] = result
    return result


@router.post(
    "/photo",
    response_model=HalalVerdict,
    responses={
        400: {"model": ErrorResponse, "description": "Not an image, or too large"},
        422: {"model": ErrorResponse, "description": "No ingredients list found in the photo"},
        503: {"model": ErrorResponse, "description": "Ingredient checker unavailable"},
    },
)
async def check_photo(llm: Llm, image: Annotated[UploadFile, File()]) -> HalalVerdict:
    max_bytes = get_settings().max_image_bytes
    if image.content_type not in _IMAGE_TYPES:
        raise InvalidInputError("Upload a JPEG, PNG or WebP photo.")
    data = await image.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise InvalidInputError(f"Photo must be {max_bytes // (1024 * 1024)} MB or smaller.")

    review = await llm.review(image=data, image_type=image.content_type)
    if not review.ingredients_text:
        raise UnreadableImageError()
    reasons = _merge(check_ingredients(review.ingredients_text), review.reasons)
    return HalalVerdict(
        verdict=overall_verdict(reasons),
        reasons=reasons,
        ingredients_text=review.ingredients_text,
        ai_checked=True,
    )
