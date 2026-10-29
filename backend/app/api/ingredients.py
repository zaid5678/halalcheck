from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from starlette.concurrency import run_in_threadpool

from app.ai.analysis import IngredientsAnalyzer
from app.ai.openrouter import OpenRouterClient
from app.config import get_settings
from app.errors import InvalidInputError
from app.images import ImageTooLargeError, UnsupportedImageTypeError, prepare_image
from app.models.analysis import IngredientsAnalysis, LabelReadingResult
from app.models.product import ErrorResponse
from app.rate_limit import SlidingWindowRateLimiter

router = APIRouter(prefix="/api/ingredients", tags=["ingredients"])

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp"}
# Some browsers send no type, or a generic one, for camera captures; the file's bytes are checked
# either way.
GENERIC_CONTENT_TYPES = {"", "application/octet-stream"}
MAX_TEXT_LENGTH = 5000
_READ_CHUNK = 256 * 1024


def get_analyzer(request: Request) -> IngredientsAnalyzer:
    settings = get_settings()
    client = OpenRouterClient(request.app.state.openrouter_http, settings)
    return IngredientsAnalyzer(
        client,
        model=settings.openrouter_model,
        structured_outputs=settings.openrouter_structured_outputs,
        reading_model=settings.halal_model,
    )


def get_rate_limiter(request: Request) -> SlidingWindowRateLimiter:
    limiter: SlidingWindowRateLimiter = request.app.state.analysis_rate_limiter
    return limiter


async def read_upload(upload: UploadFile, max_bytes: int) -> bytes:
    """Read an upload into memory, stopping as soon as it exceeds ``max_bytes``."""
    chunks: list[bytes] = []
    size = 0
    while chunk := await upload.read(_READ_CHUNK):
        size += len(chunk)
        if size > max_bytes:
            megabytes = max_bytes // (1024 * 1024)
            raise ImageTooLargeError(
                f"That image is too large. Please use an image under {megabytes} MB."
            )
        chunks.append(chunk)
    return b"".join(chunks)


async def prepare_upload(image: UploadFile) -> bytes:
    """Validate an uploaded photo and return it as a metadata-free JPEG for the model."""
    settings = get_settings()
    content_type = (image.content_type or "").split(";")[0].strip().lower()
    if content_type not in ALLOWED_CONTENT_TYPES | GENERIC_CONTENT_TYPES:
        raise UnsupportedImageTypeError()
    try:
        data = await read_upload(image, settings.max_upload_bytes)
    finally:
        await image.close()
    if not data:
        raise InvalidInputError("The uploaded file is empty.")
    jpeg: bytes = await run_in_threadpool(
        prepare_image,
        data,
        max_pixels=settings.max_image_pixels,
        max_edge=settings.analysis_image_max_edge,
    )
    return jpeg


@router.post(
    "/read",
    response_model=LabelReadingResult,
    responses={
        400: {"model": ErrorResponse, "description": "Missing or unreadable image"},
        413: {"model": ErrorResponse, "description": "Image too large"},
        415: {"model": ErrorResponse, "description": "Unsupported file type"},
        429: {"model": ErrorResponse, "description": "Rate limit reached"},
        502: {"model": ErrorResponse, "description": "Model rejected the request or replied badly"},
        503: {"model": ErrorResponse, "description": "AI not configured or unavailable"},
        504: {"model": ErrorResponse, "description": "AI timed out"},
    },
)
async def read_label(
    request: Request,
    analyzer: Annotated[IngredientsAnalyzer, Depends(get_analyzer)],
    limiter: Annotated[SlidingWindowRateLimiter, Depends(get_rate_limiter)],
    image: Annotated[
        UploadFile, File(description="Photo of the ingredients label (JPEG, PNG or WebP)")
    ],
) -> LabelReadingResult:
    """Step 1: read and interpret an ingredients label in any language, for the user to check.

    Returns the original text, an English interpretation of each ingredient, detected languages
    and any uncertain readings. No halal assessment is made at this step.
    """
    image_jpeg = await prepare_upload(image)
    limiter.check(request.client.host if request.client else "unknown")
    return await analyzer.read(image_jpeg)


@router.post(
    "/analyze",
    response_model=IngredientsAnalysis,
    responses={
        400: {"model": ErrorResponse, "description": "Missing input or unreadable image"},
        413: {"model": ErrorResponse, "description": "Image too large"},
        415: {"model": ErrorResponse, "description": "Unsupported file type"},
        429: {"model": ErrorResponse, "description": "Rate limit reached"},
        502: {"model": ErrorResponse, "description": "Model rejected the request or replied badly"},
        503: {"model": ErrorResponse, "description": "AI not configured or unavailable"},
        504: {"model": ErrorResponse, "description": "AI timed out"},
    },
)
async def analyze_ingredients(
    request: Request,
    analyzer: Annotated[IngredientsAnalyzer, Depends(get_analyzer)],
    limiter: Annotated[SlidingWindowRateLimiter, Depends(get_rate_limiter)],
    image: Annotated[
        UploadFile | None,
        File(description="Photo of the ingredients label (JPEG, PNG or WebP)"),
    ] = None,
    ingredients_text: Annotated[
        str | None,
        Form(description="User-corrected ingredients text. Takes precedence over the photo."),
    ] = None,
) -> IngredientsAnalysis:
    """Step 2: assess ingredients for halal-relevant concerns using a vision model.

    Send the confirmed ingredients text with the photo as supporting evidence (recommended), a
    photo alone, or text alone. The image is processed in memory, stripped of metadata, sent to
    OpenRouter and never stored by HalalCheck. The result is informational guidance, not a
    religious ruling or certification.
    """
    text = (ingredients_text or "").strip() or None
    if text is not None and len(text) > MAX_TEXT_LENGTH:
        raise InvalidInputError(
            f"The ingredients text is too long. Please keep it under {MAX_TEXT_LENGTH} characters."
        )

    image_jpeg = await prepare_upload(image) if image is not None else None

    if image_jpeg is None and text is None:
        raise InvalidInputError("Please add a photo of the ingredients label.")

    limiter.check(request.client.host if request.client else "unknown")
    return await analyzer.analyze(image_jpeg=image_jpeg, corrected_text=text)
