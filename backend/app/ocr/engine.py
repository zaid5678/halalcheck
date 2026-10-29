"""OCR engines. ``OcrEngine`` is the seam for swapping Tesseract for another engine later."""

import logging
from dataclasses import dataclass, field
from typing import Any, Protocol

import numpy as np
import pytesseract
from numpy.typing import NDArray

from app.ocr.errors import OcrFailedError, OcrTimeoutError, OcrUnavailableError

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class OcrWord:
    text: str
    confidence: float
    # Position of the word's line in the page layout, used to rebuild line breaks.
    block: int = 0
    paragraph: int = 0
    line: int = 0


@dataclass(frozen=True)
class OcrResult:
    words: list[OcrWord] = field(default_factory=list)

    @property
    def text(self) -> str:
        """Words joined into lines, with a blank line between separate blocks of text."""
        blocks: list[list[str]] = []
        current_block: tuple[int, int] | None = None
        current_line: tuple[int, int, int] | None = None
        for word in self.words:
            block_key = (word.block, word.paragraph)
            line_key = (word.block, word.paragraph, word.line)
            if block_key != current_block:
                blocks.append([])
                current_block = block_key
                current_line = None
            if line_key != current_line:
                blocks[-1].append(word.text)
                current_line = line_key
            else:
                blocks[-1][-1] += f" {word.text}"
        return "\n\n".join("\n".join(lines) for lines in blocks).strip()

    @property
    def readable_words(self) -> list[OcrWord]:
        """Words containing at least one letter or digit (ignores stray punctuation)."""
        return [word for word in self.words if any(ch.isalnum() for ch in word.text)]

    @property
    def mean_confidence(self) -> float | None:
        words = self.readable_words
        if not words:
            return None
        return sum(word.confidence for word in words) / len(words)

    @property
    def score(self) -> float:
        """Used to pick the best of several attempts: rewards many confidently read words."""
        return sum(word.confidence for word in self.readable_words if word.confidence >= 30)


class OcrEngine(Protocol):
    def recognise(self, image: NDArray[np.uint8]) -> OcrResult: ...

    def detect_rotation(self, image: NDArray[np.uint8]) -> int | None:
        """Clockwise degrees (0/90/180/270) needed to make the text upright, if detectable."""
        ...

    def is_available(self) -> bool: ...


class TesseractEngine:
    def __init__(self, languages: str, timeout: float, tesseract_cmd: str | None = None) -> None:
        self._languages = languages
        self._timeout = timeout
        if tesseract_cmd:
            pytesseract.pytesseract.tesseract_cmd = tesseract_cmd

    def recognise(self, image: NDArray[np.uint8]) -> OcrResult:
        # --oem 1: LSTM engine. --psm 3: automatic page segmentation, since label photos often
        # include other text around the ingredients list.
        data = self._run(
            pytesseract.image_to_data,
            image,
            lang=self._languages,
            config="--oem 1 --psm 3",
            output_type=pytesseract.Output.DICT,
        )
        return OcrResult(words=list(_parse_words(data)))

    def detect_rotation(self, image: NDArray[np.uint8]) -> int | None:
        try:
            osd = self._run(
                pytesseract.image_to_osd,
                image,
                config="--psm 0",
                output_type=pytesseract.Output.DICT,
            )
        except OcrFailedError:
            # Orientation detection fails when there is too little text; that's not fatal.
            return None
        rotate = osd.get("rotate")
        return int(rotate) if isinstance(rotate, int | float) else None

    def is_available(self) -> bool:
        try:
            pytesseract.get_tesseract_version()
        except (pytesseract.TesseractNotFoundError, OSError):
            return False
        return True

    def _run(self, function: Any, image: NDArray[np.uint8], **kwargs: Any) -> Any:
        try:
            return function(image, timeout=self._timeout, **kwargs)
        except pytesseract.TesseractNotFoundError as exc:
            logger.error("Tesseract is not installed or not on PATH")
            raise OcrUnavailableError() from exc
        except RuntimeError as exc:
            # pytesseract signals timeouts with a plain RuntimeError.
            if "timeout" in str(exc).lower():
                logger.warning("Tesseract timed out after %.0fs", self._timeout)
                raise OcrTimeoutError() from exc
            raise OcrFailedError() from exc
        except pytesseract.TesseractError as exc:
            logger.warning("Tesseract failed: %s", exc.message[:200] if exc.message else exc.status)
            raise OcrFailedError() from exc


def _parse_words(data: dict[str, list[Any]]) -> list[OcrWord]:
    words: list[OcrWord] = []
    for index, raw_text in enumerate(data.get("text", [])):
        text = str(raw_text).strip()
        try:
            confidence = float(data["conf"][index])
        except (KeyError, IndexError, TypeError, ValueError):
            continue
        # Tesseract reports -1 for layout rows that are not words.
        if not text or confidence < 0:
            continue
        words.append(
            OcrWord(
                text=text,
                confidence=min(confidence, 100.0),
                block=int(data["block_num"][index]),
                paragraph=int(data["par_num"][index]),
                line=int(data["line_num"][index]),
            )
        )
    return words
