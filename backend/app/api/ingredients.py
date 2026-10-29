import asyncio
from functools import lru_cache
from typing import Annotated

from fastapi import APIRouter, Depends, File, Request, UploadFile
from starlette.concurrency import run_in_threadpool

from app.config import get_settings
from app.errors import InvalidInputError
from app.models.ingredients import IngredientsExtraction
from app.models.product import ErrorResponse
from app.ocr.engine import OcrEngine, TesseractEngine
from app.ocr.errors import ImageTooLargeError, UnsupportedImageTypeError
from app.ocr.service import IngredientsOcrService

router = APIRouter(prefix="/api/ingredients", tags=["ingredients"])

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp"}
# Some browsers send no type, or a generic one, for camera captures; the file's bytes are checked
# either way.
GENERIC_CONTENT_TYPES = {"", "application/octet-stream"}
_READ_CHUNK = 256 * 1024


@lru_cache
def get_ocr_engine() -> OcrEngine:
    settings = get_settings()
    return TesseractEngine(
        languages=settings.ocr_languages,
        timeout=settings.ocr_timeout_seconds,
        tesseract_cmd=settings.tesseract_cmd,
    )


def get_ocr_service(engine: Annotated[OcrEngine, Depends(get_ocr_engine)]) -> IngredientsOcrService:
    return IngredientsOcrService(engine, max_image_pixels=get_settings().ocr_max_image_pixels)


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


@router.post(
    "/extract",
    response_model=IngredientsExtraction,
    responses={
        400: {"model": ErrorResponse, "description": "Missing, empty or unreadable image"},
        413: {"model": ErrorResponse, "description": "Image too large"},
        415: {"model": ErrorResponse, "description": "Unsupported file type"},
        422: {"model": ErrorResponse, "description": "No text found in the image"},
        500: {"model": ErrorResponse, "description": "OCR failed"},
        503: {"model": ErrorResponse, "description": "OCR engine unavailable"},
        504: {"model": ErrorResponse, "description": "OCR took too long"},
    },
)
async def extract_ingredients(
    request: Request,
    service: Annotated[IngredientsOcrService, Depends(get_ocr_service)],
    image: Annotated[
        UploadFile, File(description="Photo of an ingredients label (JPEG, PNG or WebP)")
    ],
) -> IngredientsExtraction:
    """Read the text from a photo of an ingredients label.

    The image is processed in memory and discarded after the response; it is never stored.
    The text is returned exactly as recognised, for the user to review and correct.
    """
    content_type = (image.content_type or "").split(";")[0].strip().lower()
    if content_type not in ALLOWED_CONTENT_TYPES | GENERIC_CONTENT_TYPES:
        raise UnsupportedImageTypeError()

    try:
        data = await read_upload(image, get_settings().ocr_max_upload_bytes)
    finally:
        await image.close()
    if not data:
        raise InvalidInputError("The uploaded file is empty.")

    semaphore: asyncio.Semaphore = request.app.state.ocr_semaphore
    async with semaphore:
        return await run_in_threadpool(service.extract, data)
