import io
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field

import numpy as np
import pytest
from fastapi.testclient import TestClient
from numpy.typing import NDArray
from PIL import Image, ImageDraw, ImageFont

from app.api.ingredients import get_ocr_engine
from app.main import app
from app.ocr.engine import OcrResult, OcrWord


@dataclass
class FakeOcrEngine:
    """Stands in for Tesseract. Returns queued results in order (repeating the last one)."""

    results: list[OcrResult | Exception] = field(default_factory=list)
    rotation: int | None = None
    available: bool = True
    images: list[NDArray[np.uint8]] = field(default_factory=list)
    rotation_checks: int = 0

    def recognise(self, image: NDArray[np.uint8]) -> OcrResult:
        self.images.append(image)
        index = min(len(self.images) - 1, len(self.results) - 1)
        result = self.results[index] if self.results else OcrResult()
        if isinstance(result, Exception):
            raise result
        return result

    def detect_rotation(self, image: NDArray[np.uint8]) -> int | None:
        self.rotation_checks += 1
        return self.rotation

    def is_available(self) -> bool:
        return self.available


def words(text: str, confidence: float = 95.0, line: int = 1) -> list[OcrWord]:
    return [OcrWord(word, confidence, block=1, paragraph=1, line=line) for word in text.split()]


@pytest.fixture
def ocr_engine() -> FakeOcrEngine:
    return FakeOcrEngine()


@pytest.fixture
def client(ocr_engine: FakeOcrEngine) -> Iterator[TestClient]:
    app.dependency_overrides[get_ocr_engine] = lambda: ocr_engine
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


def encode(image: Image.Image, image_format: str = "JPEG", **options: object) -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, image_format, **options)
    return buffer.getvalue()


def make_label(lines: list[str], size: tuple[int, int] = (1400, 420)) -> Image.Image:
    """Render a fake ingredients label as dark text on a beige background."""
    image = Image.new("RGB", size, (235, 228, 210))
    draw = ImageDraw.Draw(image)
    font = ImageFont.load_default(size=44)
    for index, line in enumerate(lines):
        draw.text((40, 40 + index * 90), line, fill=(40, 30, 30), font=font)
    return image


LabelFactory = Callable[..., Image.Image]
