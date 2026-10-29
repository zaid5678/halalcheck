"""Unit tests for image loading, preprocessing and the Tesseract wrapper, plus an end-to-end
test against the real Tesseract binary when it is installed."""

import io
from typing import Any

import numpy as np
import pytesseract
import pytest
from PIL import Image

from app.ocr import preprocessing
from app.ocr.engine import OcrResult, OcrWord, TesseractEngine, _parse_words
from app.ocr.errors import (
    InvalidImageError,
    OcrFailedError,
    OcrTimeoutError,
    OcrUnavailableError,
    UnsupportedImageTypeError,
)
from app.ocr.image_io import load_grayscale, sniff_format
from app.ocr.service import IngredientsOcrService
from tests.conftest import encode, make_label

# --- Image loading --------------------------------------------------------------------------


def test_sniff_format() -> None:
    label = make_label(["x"])
    assert sniff_format(encode(label, "JPEG")) == "JPEG"
    assert sniff_format(encode(label, "PNG")) == "PNG"
    assert sniff_format(encode(label, "WEBP")) == "WEBP"
    assert sniff_format(encode(label, "GIF")) is None
    assert sniff_format(b"") is None


def test_load_grayscale_applies_exif_orientation() -> None:
    image = Image.new("RGB", (200, 100), "white")
    exif = Image.Exif()
    exif[0x0112] = 6  # "Rotate 90 CW to display": how phones store portrait photos.

    gray = load_grayscale(encode(image, "JPEG", exif=exif), max_pixels=10**7)

    assert gray.shape == (200, 100)
    assert gray.dtype == np.uint8


def test_load_grayscale_puts_transparency_on_white() -> None:
    image = Image.new("RGBA", (100, 100), (0, 0, 0, 0))

    gray = load_grayscale(encode(image, "PNG"), max_pixels=10**7)

    assert gray.min() == 255


def test_load_grayscale_rejects_unknown_bytes() -> None:
    with pytest.raises(UnsupportedImageTypeError):
        load_grayscale(b"hello world", max_pixels=10**7)


def test_load_grayscale_rejects_corrupt_png() -> None:
    data = encode(make_label(["x"]), "PNG")
    corrupt = data[:60] + b"\x00" * 200

    with pytest.raises(InvalidImageError):
        load_grayscale(corrupt, max_pixels=10**7)


# --- Preprocessing --------------------------------------------------------------------------


def test_resize_upscales_small_images() -> None:
    small = np.full((150, 500), 255, dtype=np.uint8)
    assert preprocessing.resize_for_ocr(small).shape == (450, 1500)  # capped at 3x


def test_resize_downscales_large_images() -> None:
    large = np.full((3000, 4000), 255, dtype=np.uint8)
    assert preprocessing.resize_for_ocr(large).shape == (1800, 2400)


def test_resize_leaves_mid_sized_images() -> None:
    image = np.full((1500, 2000), 255, dtype=np.uint8)
    assert preprocessing.resize_for_ocr(image) is image


@pytest.mark.parametrize("tilt", [6.0, -9.0, 15.0])
def test_estimate_and_correct_skew(tilt: float) -> None:
    label = np.asarray(
        make_label(["Ingredients: sugar, salt", "palm oil, cocoa butter"]).convert("L")
    )
    tilted = preprocessing.rotate(label, tilt)

    estimate = preprocessing.estimate_skew(tilted)
    assert estimate == pytest.approx(-tilt, abs=1.0)

    corrected = preprocessing.correct_skew(tilted)
    assert abs(preprocessing.estimate_skew(corrected)) < 1.0


def test_skew_estimate_is_zero_without_text() -> None:
    blank = np.full((400, 400), 255, dtype=np.uint8)
    assert preprocessing.estimate_skew(blank) == 0.0


def test_rotate_quarter_turns() -> None:
    image = np.zeros((100, 300), dtype=np.uint8)
    assert preprocessing.rotate_quarter_turns(image, 90).shape == (300, 100)
    assert preprocessing.rotate_quarter_turns(image, 180).shape == (100, 300)
    assert preprocessing.rotate_quarter_turns(image, 0) is image


def test_binarize_outputs_black_and_white() -> None:
    gray = np.asarray(make_label(["sugar"]).convert("L"))
    assert set(np.unique(preprocessing.binarize(gray))) <= {0, 255}


def test_standard_pipeline_keeps_dtype() -> None:
    gray = np.asarray(make_label(["sugar"]).convert("L"))
    result = preprocessing.apply(gray, preprocessing.STANDARD_STEPS)
    assert result.dtype == np.uint8
    assert result.ndim == 2


# --- OCR result handling --------------------------------------------------------------------


def test_result_text_preserves_lines_and_blocks() -> None:
    result = OcrResult(
        words=[
            OcrWord("INGREDIENTS:", 90, block=1, paragraph=1, line=1),
            OcrWord("sugar,", 90, block=1, paragraph=1, line=1),
            OcrWord("salt.", 90, block=1, paragraph=1, line=2),
            OcrWord("Best", 90, block=2, paragraph=1, line=1),
            OcrWord("before", 90, block=2, paragraph=1, line=1),
        ]
    )
    assert result.text == "INGREDIENTS: sugar,\nsalt.\n\nBest before"


def test_parse_words_skips_layout_rows_and_blanks() -> None:
    data: dict[str, list[Any]] = {
        "text": ["", "sugar", " ", "salt", "oops"],
        "conf": [-1, 91.5, 50, "88", "not-a-number"],
        "block_num": [1, 1, 1, 1, 1],
        "par_num": [1, 1, 1, 1, 1],
        "line_num": [1, 1, 1, 2, 2],
    }
    parsed = _parse_words(data)
    assert [(w.text, w.confidence, w.line) for w in parsed] == [
        ("sugar", 91.5, 1),
        ("salt", 88.0, 2),
    ]


# --- Tesseract error mapping ----------------------------------------------------------------


@pytest.mark.parametrize(
    ("raised", "expected"),
    [
        (pytesseract.TesseractNotFoundError(), OcrUnavailableError),
        (RuntimeError("Tesseract process timeout"), OcrTimeoutError),
        (pytesseract.TesseractError(1, "Error opening data file"), OcrFailedError),
    ],
)
def test_tesseract_errors_are_mapped(
    monkeypatch: pytest.MonkeyPatch, raised: Exception, expected: type[Exception]
) -> None:
    def fail(*_args: object, **_kwargs: object) -> None:
        raise raised

    monkeypatch.setattr(pytesseract, "image_to_data", fail)

    with pytest.raises(expected):
        TesseractEngine("eng", timeout=5).recognise(np.zeros((50, 50), dtype=np.uint8))


def test_rotation_detection_failure_is_not_fatal(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail(*_args: object, **_kwargs: object) -> None:
        raise pytesseract.TesseractError(1, "Too few characters")

    monkeypatch.setattr(pytesseract, "image_to_osd", fail)

    assert (
        TesseractEngine("eng", timeout=5).detect_rotation(np.zeros((50, 50), dtype=np.uint8))
        is None
    )


# --- Real Tesseract -------------------------------------------------------------------------

requires_tesseract = pytest.mark.skipif(
    not TesseractEngine("eng", timeout=5).is_available(), reason="Tesseract is not installed"
)

LINES = [
    "INGREDIENTS: Wheat flour, sugar, palm oil,",
    "cocoa powder (4%), gelatine (beef),",
    "emulsifier (E471), salt.",
]


@requires_tesseract
@pytest.mark.parametrize(
    "transform",
    [
        lambda image: image,
        lambda image: image.rotate(8, expand=True, fillcolor=(235, 228, 210)),
        lambda image: image.rotate(90, expand=True),
        lambda image: image.resize((560, 168)),
    ],
    ids=["straight", "tilted", "sideways", "low-resolution"],
)
def test_real_tesseract_reads_label(transform: Any) -> None:
    service = IngredientsOcrService(TesseractEngine("eng", timeout=30), max_image_pixels=10**7)
    buffer = io.BytesIO()
    transform(make_label(LINES)).save(buffer, "JPEG", quality=85)

    result = service.extract(buffer.getvalue())

    assert "gelatine (beef)" in result.text
    assert "E471" in result.text
    assert result.confidence is not None and result.confidence > 80
    assert result.low_confidence is False


@requires_tesseract
def test_real_tesseract_blank_image_has_no_text() -> None:
    from app.ocr.errors import NoTextFoundError

    service = IngredientsOcrService(TesseractEngine("eng", timeout=30), max_image_pixels=10**7)

    with pytest.raises(NoTextFoundError):
        service.extract(encode(Image.new("RGB", (800, 600), (235, 228, 210))))
