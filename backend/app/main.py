import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.ai.openrouter import build_http_client
from app.api import ingredients, products
from app.config import get_settings
from app.errors import AppError
from app.models.product import HealthResponse
from app.rate_limit import SlidingWindowRateLimiter

settings = get_settings()
logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("halalcheck")

# Multipart overhead (form fields, boundaries, corrected text) allowed on top of the image.
_UPLOAD_OVERHEAD_BYTES = 64 * 1024


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.openrouter_http = build_http_client(settings)
    app.state.analysis_rate_limiter = SlidingWindowRateLimiter(
        settings.analysis_rate_limit_per_hour
    )
    if not settings.ai_configured:
        logger.warning("OPENROUTER_API_KEY is not set: ingredient analysis will return 503")
    else:
        logger.info("Ingredient analysis model: %s", settings.openrouter_model)
    try:
        yield
    finally:
        await app.state.openrouter_http.aclose()


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
        megabytes = settings.max_upload_bytes // (1024 * 1024)
        return _error(
            413,
            "image_too_large",
            f"That image is too large. Please use an image under {megabytes} MB.",
        )
    return await call_next(request)


@app.exception_handler(AppError)
async def app_error_handler(_: Request, exc: AppError) -> JSONResponse:
    return _error(exc.status_code, exc.code, exc.message)


@app.exception_handler(RequestValidationError)
async def request_validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    first = exc.errors()[0] if exc.errors() else {}
    location = [str(part) for part in first.get("loc", ())]
    field = ".".join(location[1:]) or "request"
    return _error(400, "invalid_request", f"Invalid {field}: {first.get('msg', 'invalid value')}")


@app.get("/api/health", response_model=HealthResponse, tags=["health"])
async def health() -> HealthResponse:
    return HealthResponse(ai_configured=get_settings().ai_configured)


app.include_router(products.router)
app.include_router(ingredients.router)
