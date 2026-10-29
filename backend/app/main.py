import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import halal, products
from app.config import get_settings
from app.errors import AppError
from app.models.product import HealthResponse
from app.services.open_food_facts import build_http_client

settings = get_settings()
logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("halalcheck")

# Multipart overhead allowed on top of the image itself.
_UPLOAD_OVERHEAD_BYTES = 64 * 1024


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.http_client = build_http_client(settings)
    if not settings.openrouter_api_key:
        logger.warning("HALALCHECK_OPENROUTER_API_KEY is not set: photo checks will return 503")
    try:
        yield
    finally:
        await app.state.http_client.aclose()


app = FastAPI(title=settings.app_name, version="0.3.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


def _error(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code, content={"error": {"code": code, "message": message}}
    )


@app.middleware("http")
async def reject_oversized_uploads(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    # Refuse obviously oversized uploads before the body is read or spooled to disk.
    content_length = request.headers.get("content-length", "")
    limit = settings.max_upload_bytes + _UPLOAD_OVERHEAD_BYTES
    if request.method == "POST" and content_length.isdigit() and int(content_length) > limit:
        return _error(413, halal.ImageTooLargeError.code, halal.ImageTooLargeError.message)
    return await call_next(request)


@app.exception_handler(AppError)
async def app_error_handler(_: Request, exc: AppError) -> JSONResponse:
    return _error(exc.status_code, exc.code, exc.message)


@app.exception_handler(RequestValidationError)
async def request_validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    first = exc.errors()[0] if exc.errors() else {}
    location = [str(part) for part in first.get("loc", ())]
    if location[:2] == ["body", "image"]:
        return _error(400, "invalid_request", "Please choose an image to upload.")
    field = ".".join(location[1:]) or "request"
    return _error(400, "invalid_request", f"Invalid {field}: {first.get('msg', 'invalid value')}")


@app.get("/api/health", response_model=HealthResponse, tags=["health"])
async def health() -> HealthResponse:
    return HealthResponse()


app.include_router(products.router)
app.include_router(halal.router)
