import logging
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from starlette.concurrency import run_in_threadpool

from app.api.ingredients import (
    ALLOWED_CONTENT_TYPES,
    GENERIC_CONTENT_TYPES,
    MAX_TEXT_LENGTH,
    get_rate_limiter,
    read_upload,
)
from app.api.products import Lookup
from app.config import get_settings
from app.errors import InvalidInputError
from app.evidence import PrincipleExplanation, explain
from app.images import UnsupportedImageTypeError, prepare_image
from app.models.halal import HalalVerdict, Reason
from app.models.product import ErrorResponse
from app.rate_limit import SlidingWindowRateLimiter
from app.services.llm import LLMClient, LLMError, UnreadableImageError
from app.services.rules import check_ingredients, is_ruled_halal, overall_verdict
from app.validation import normalise_barcode

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/halal", tags=["halal"])

# Final verdicts by barcode. In-memory, so it resets when the server restarts.
verdict_cache: dict[str, HalalVerdict] = {}
_NO_INGREDIENTS = Reason(
    ingredient="Ingredients",
    ruling="doubtful",
    note="Ingredients are not available for this product",
)


def get_llm_client(request: Request) -> LLMClient:
    return LLMClient(request.app.state.http_client, get_settings())


Llm = Annotated[LLMClient, Depends(get_llm_client)]


def _merge(rule_reasons: list[Reason], llm_reasons: list[Reason]) -> list[Reason]:
    """Rule findings always stand; the LLM only adds concerns, never on terms ruled halal."""
    seen = [reason.ingredient.lower() for reason in rule_reasons]
    extra = [
        r
        for r in llm_reasons
        if r.ruling != "halal"
        and not is_ruled_halal(r.ingredient)
        and not any(term in r.ingredient.lower() for term in seen)
    ]
    return rule_reasons + extra


async def _judge(llm: LLMClient, text: str) -> HalalVerdict:
    """Rules first; if they find nothing haram, the LLM reviews for concerns they missed."""
    reasons = check_ingredients(text)
    ai_checked = False
    if overall_verdict(reasons) != "haram":  # haram from the rules is final; skip the LLM
        try:
            reasons = _merge(reasons, (await llm.review(text)).reasons)
            ai_checked = True
        except LLMError:
            logger.info("Returning rules-only verdict")
    return HalalVerdict(
        verdict=overall_verdict(reasons),
        reasons=reasons,
        ingredients_text=text,
        ai_checked=ai_checked,
        explanations=_explanations(reasons),
    )


def _explanations(reasons: list[Reason]) -> list[PrincipleExplanation]:
    """Curated evidence for each principle behind a haram ruling (never AI-written)."""
    principle_ids = dict.fromkeys(
        r.principle_id for r in reasons if r.ruling == "haram" and r.principle_id
    )
    return [e for e in (explain(pid) for pid in principle_ids if pid) if e is not None]


@router.get(
    "/barcode/{barcode}",
    response_model=HalalVerdict,
    responses={404: {"model": ErrorResponse, "description": "Product not found"}},
)
async def check_barcode(lookup: Lookup, llm: Llm, barcode: str) -> HalalVerdict:
    code = normalise_barcode(barcode)
    if code in verdict_cache:
        return verdict_cache[code]

    product = await lookup.get_product(code)
    text = product.ingredients_text
    if not text:
        return HalalVerdict(
            verdict="doubtful",
            reasons=[_NO_INGREDIENTS],
            ingredients_text=None,
            ai_checked=False,
            product=product,
        )

    result = await _judge(llm, text)
    result.product = product
    if result.ai_checked or result.verdict == "haram":
        verdict_cache[code] = result
    return result


@router.post(
    "/photo",
    response_model=HalalVerdict,
    responses={
        400: {"model": ErrorResponse, "description": "No photo or text, or an unreadable image"},
        413: {"model": ErrorResponse, "description": "Image too large"},
        415: {"model": ErrorResponse, "description": "Unsupported file type"},
        422: {"model": ErrorResponse, "description": "No ingredients list found in the photo"},
        429: {"model": ErrorResponse, "description": "Rate limit reached"},
        503: {"model": ErrorResponse, "description": "Ingredient checker unavailable"},
    },
)
async def check_photo(
    request: Request,
    llm: Llm,
    limiter: Annotated[SlidingWindowRateLimiter, Depends(get_rate_limiter)],
    image: Annotated[UploadFile | None, File(description="Photo of the ingredients label")] = None,
    ingredients_text: Annotated[
        str | None, Form(description="Corrected ingredients text; skips reading the photo.")
    ] = None,
) -> HalalVerdict:
    """Read an ingredients label photo (or take corrected text) and judge it.

    The photo is processed in memory and never stored by HalalCheck.
    """
    settings = get_settings()
    text = (ingredients_text or "").strip() or None
    if text is not None and len(text) > MAX_TEXT_LENGTH:
        raise InvalidInputError(
            f"The ingredients text is too long. Please keep it under {MAX_TEXT_LENGTH} characters."
        )

    image_jpeg: bytes | None = None
    if text is None and image is not None:
        content_type = (image.content_type or "").split(";")[0].strip().lower()
        if content_type not in ALLOWED_CONTENT_TYPES | GENERIC_CONTENT_TYPES:
            raise UnsupportedImageTypeError()
        try:
            data = await read_upload(image, settings.max_upload_bytes)
        finally:
            await image.close()
        if not data:
            raise InvalidInputError("The uploaded file is empty.")
        image_jpeg = await run_in_threadpool(
            prepare_image,
            data,
            max_pixels=settings.max_image_pixels,
            max_edge=settings.halal_image_max_edge,
        )

    if image_jpeg is None and text is None:
        raise InvalidInputError("Please add a photo of the ingredients label.")

    limiter.check(request.client.host if request.client else "unknown")
    if text is None:
        assert image_jpeg is not None
        text = await llm.read_label(image_jpeg)
        if text is None:
            raise UnreadableImageError()
    return await _judge(llm, text)
