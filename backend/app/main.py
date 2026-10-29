import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import products
from app.config import get_settings
from app.models.product import HealthResponse
from app.services.open_food_facts import OpenFoodFactsError, build_http_client
from app.validation import InvalidInputError

settings = get_settings()
logging.basicConfig(
    level=settings.log_level.upper(),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("halalcheck")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.http_client = build_http_client(settings)
    try:
        yield
    finally:
        await app.state.http_client.aclose()


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["GET"],
    allow_headers=["*"],
)


def _error(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code, content={"error": {"code": code, "message": message}}
    )


@app.exception_handler(InvalidInputError)
async def invalid_input_handler(_: Request, exc: InvalidInputError) -> JSONResponse:
    return _error(400, "invalid_request", str(exc))


@app.exception_handler(RequestValidationError)
async def request_validation_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    first = exc.errors()[0] if exc.errors() else {}
    field = ".".join(str(part) for part in first.get("loc", ())[1:]) or "request"
    return _error(400, "invalid_request", f"Invalid {field}: {first.get('msg', 'invalid value')}")


@app.exception_handler(OpenFoodFactsError)
async def upstream_error_handler(_: Request, exc: OpenFoodFactsError) -> JSONResponse:
    return _error(exc.status_code, exc.code, exc.message)


@app.get("/api/health", response_model=HealthResponse, tags=["health"])
async def health() -> HealthResponse:
    return HealthResponse()


app.include_router(products.router)
