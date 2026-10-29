import logging
from typing import Annotated

from fastapi import APIRouter, Depends, Request

from app.api.products import Lookup
from app.config import get_settings
from app.models.halal import HalalVerdict, Reason
from app.models.product import ErrorResponse
from app.services.llm import LLMClient, LLMError
from app.services.rules import check_ingredients, overall_verdict
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
