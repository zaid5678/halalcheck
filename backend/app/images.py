"""Validate uploaded photos and prepare them for the vision model."""

import io
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError

from app.errors import AppError

SUPPORTED_FORMATS = {"JPEG", "PNG", "WEBP"}
MIN_DIMENSION = 64


class UnsupportedImageTypeError(AppError):
    code = "unsupported_image_type"
    status_code = 415
    message = "That file type isn't supported. Please upload a JPEG, PNG or WebP image."


class ImageTooLargeError(AppError):
    code = "image_too_large"
    status_code = 413
    message = "That image is too large. Please use an image under 10 MB."


class InvalidImageError(AppError):
    code = "invalid_image"
    status_code = 400
    message = "We couldn't open that image. It may be damaged or not a real image file."


def sniff_format(data: bytes) -> str | None:
    """Identify the image format from its first bytes rather than trusting the filename."""
    if data.startswith(b"\xff\xd8\xff"):
        return "JPEG"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "PNG"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "WEBP"
    return None


def prepare_image(data: bytes, *, max_pixels: int, max_edge: int) -> bytes:
    """Validate an upload and return it as an upright JPEG no larger than ``max_edge``.

    Re-encoding also strips all metadata (including any GPS location) before the image is
    sent to a third-party model.
    """
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
                    "That image is too small to read. Please use a larger, closer photo."
                )

            opened.load()
            # Phone cameras store rotation in EXIF metadata rather than in the pixels.
            image: Image.Image = ImageOps.exif_transpose(opened)
            if image.mode in ("RGBA", "LA", "PA") or "transparency" in image.info:
                # Put transparent images on white so transparent areas don't become black.
                rgba = image.convert("RGBA")
                background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
                image = Image.alpha_composite(background, rgba)
            image = image.convert("RGB")
            image.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)

            output = io.BytesIO()
            image.save(output, "JPEG", quality=90, optimize=True)
            return output.getvalue()
    except (UnsupportedImageTypeError, InvalidImageError):
        raise
    except (UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise InvalidImageError() from None
    except (OSError, ValueError, SyntaxError):
        # Pillow raises these for truncated or corrupt files.
        raise InvalidImageError() from None
