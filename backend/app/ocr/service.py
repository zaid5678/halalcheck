"""Turns an uploaded label photo into text for the user to review and correct."""

import logging
import time

from app.models.ingredients import IngredientsExtraction
from app.ocr import preprocessing
from app.ocr.engine import OcrEngine, OcrResult
from app.ocr.errors import NoTextFoundError
from app.ocr.image_io import load_grayscale

logger = logging.getLogger(__name__)

# A first attempt this good is accepted without trying slower alternatives.
GOOD_ENOUGH_CONFIDENCE = 75.0
GOOD_ENOUGH_WORDS = 5
LOW_CONFIDENCE_THRESHOLD = 60.0
UNCERTAIN_WORD_CONFIDENCE = 60.0
MAX_UNCERTAIN_WORDS = 15
# Fragments shorter than this ("A", "es") aren't useful prompts for the user to check.
MIN_UNCERTAIN_WORD_LETTERS = 3


class IngredientsOcrService:
    def __init__(self, engine: OcrEngine, max_image_pixels: int) -> None:
        self._engine = engine
        self._max_image_pixels = max_image_pixels

    def extract(self, data: bytes) -> IngredientsExtraction:
        started = time.perf_counter()
        gray = load_grayscale(data, self._max_image_pixels)
        prepared = preprocessing.apply(gray, preprocessing.STANDARD_STEPS)

        attempts = 1
        best = self._engine.recognise(prepared)

        # Extra attempts cost several seconds each, so only make them when the first is poor.
        if not _good_enough(best):
            rotation = self._engine.detect_rotation(prepared)
            if rotation:
                prepared = preprocessing.rotate_quarter_turns(prepared, rotation)
                attempts += 1
                best = _better(best, self._engine.recognise(prepared))

        if not _good_enough(best):
            binarized = preprocessing.apply(prepared, preprocessing.FALLBACK_STEPS)
            attempts += 1
            best = _better(best, self._engine.recognise(binarized))

        confidence = best.mean_confidence
        logger.info(
            "OCR finished: %d words, confidence %s, %d attempt(s), %.1fs",
            len(best.readable_words),
            f"{confidence:.0f}" if confidence is not None else "n/a",
            attempts,
            time.perf_counter() - started,
        )

        text = best.text
        if not text or not best.readable_words:
            raise NoTextFoundError()

        return IngredientsExtraction(
            text=text,
            confidence=round(confidence, 1) if confidence is not None else None,
            word_count=len(best.readable_words),
            uncertain_words=_uncertain_words(best),
            low_confidence=confidence is None or confidence < LOW_CONFIDENCE_THRESHOLD,
        )


def _good_enough(result: OcrResult) -> bool:
    confidence = result.mean_confidence
    return (
        confidence is not None
        and confidence >= GOOD_ENOUGH_CONFIDENCE
        and len(result.readable_words) >= GOOD_ENOUGH_WORDS
    )


def _better(current: OcrResult, candidate: OcrResult) -> OcrResult:
    return candidate if candidate.score > current.score else current


def _uncertain_words(result: OcrResult) -> list[str]:
    seen: set[str] = set()
    words: list[str] = []
    for word in result.readable_words:
        key = word.text.casefold()
        letters = sum(ch.isalnum() for ch in word.text)
        if (
            word.confidence < UNCERTAIN_WORD_CONFIDENCE
            and letters >= MIN_UNCERTAIN_WORD_LETTERS
            and key not in seen
        ):
            seen.add(key)
            words.append(word.text)
            if len(words) == MAX_UNCERTAIN_WORDS:
                break
    return words
