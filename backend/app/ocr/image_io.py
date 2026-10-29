"""Safely decode uploaded image bytes into a grayscale array ready for preprocessing."""

import io
import warnings

import numpy as np
from numpy.typing import NDArray
from PIL import Image, ImageOps, UnidentifiedImageError

from app.ocr.errors import InvalidImageError, UnsupportedImageTypeError

SUPPORTED_FORMATS = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}
MIN_DIMENSION = 32


def sniff_format(data: bytes) -> str | None:
    """Identify the image format from its first bytes rather than trusting the filename."""
    if data.startswith(b"\xff\xd8\xff"):
        return "JPEG"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "PNG"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "WEBP"
    return None


def load_grayscale(data: bytes, max_pixels: int) -> NDArray[np.uint8]:
    if sniff_format(data) is None:
        raise UnsupportedImageTypeError()

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            opened = Image.open(io.BytesIO(data))
            if opened.format not in SUPPORTED_FORMATS:
                raise UnsupportedImageTypeError()

            # Check dimensions from the header before decoding any pixels.
            width, height = opened.size
            if width * height > max_pixels:
                raise InvalidImageError(
                    "That image has too many pixels to process. Please use a smaller photo."
                )
            if min(width, height) < MIN_DIMENSION:
                raise InvalidImageError(
                    "That image is too small to read. Please use a larger photo."
                )

            opened.load()
            # Phone cameras store rotation in EXIF metadata rather than in the pixels.
            image: Image.Image = ImageOps.exif_transpose(opened)
            if image.mode in ("RGBA", "LA", "PA") or "transparency" in image.info:
                # Put transparent images on white so transparent areas don't become black.
                rgba = image.convert("RGBA")
                background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
                image = Image.alpha_composite(background, rgba)
            gray = image.convert("L")
    except (UnsupportedImageTypeError, InvalidImageError):
        raise
    except (UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise InvalidImageError() from None
    except (OSError, ValueError, SyntaxError):
        # Pillow raises these for truncated or corrupt files.
        raise InvalidImageError() from None

    return np.asarray(gray, dtype=np.uint8)
