"""OpenCV preprocessing steps that make packaging photos easier for OCR to read.

Each step takes and returns a grayscale uint8 image, so steps can be reordered, removed or
replaced (for example when switching OCR engine) without touching the rest of the pipeline.
"""

from collections.abc import Callable, Sequence

import cv2
import numpy as np
from numpy.typing import NDArray

Image = NDArray[np.uint8]
Step = Callable[[Image], Image]

# Tesseract reads best when lowercase letters are roughly 20-30px tall. Ingredient text is small,
# so photos are scaled into this range: large enough for small print, small enough to stay fast.
MIN_LONG_EDGE = 1600
MAX_LONG_EDGE = 2400
MAX_UPSCALE = 3.0
# Only straighten text that is clearly but not hugely tilted; larger turns are handled by
# whole-image rotation.
MIN_SKEW_DEGREES = 0.5
MAX_SKEW_DEGREES = 20.0


def resize_for_ocr(image: Image) -> Image:
    height, width = image.shape[:2]
    long_edge = max(height, width)
    if long_edge > MAX_LONG_EDGE:
        scale = MAX_LONG_EDGE / long_edge
        interpolation = cv2.INTER_AREA
    elif long_edge < MIN_LONG_EDGE:
        scale = min(MIN_LONG_EDGE / long_edge, MAX_UPSCALE)
        interpolation = cv2.INTER_CUBIC
    else:
        return image
    size = (max(1, round(width * scale)), max(1, round(height * scale)))
    return np.asarray(cv2.resize(image, size, interpolation=interpolation), dtype=np.uint8)


def reduce_noise(image: Image) -> Image:
    # A light blur removes sensor noise and JPEG artefacts without eroding thin strokes.
    return np.asarray(cv2.GaussianBlur(image, (3, 3), 0), dtype=np.uint8)


def enhance_contrast(image: Image) -> Image:
    # CLAHE evens out shadows and glare across the label better than a global stretch.
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    return np.asarray(clahe.apply(image), dtype=np.uint8)


def binarize(image: Image) -> Image:
    # Adaptive thresholding copes with uneven lighting on curved or glossy packaging.
    return np.asarray(
        cv2.adaptiveThreshold(
            image, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 15
        ),
        dtype=np.uint8,
    )


def estimate_skew(image: Image) -> float:
    """Return the angle in degrees (counter-clockwise positive) that would level the text."""
    _, inverted = cv2.threshold(image, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
    # Join the letters of each line into horizontal bars, then measure the bars' angles.
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (25, 3))
    lines = cv2.dilate(inverted, kernel, iterations=1)
    contours, _ = cv2.findContours(lines, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    angles: list[float] = []
    weights: list[float] = []
    for contour in contours:
        rect = cv2.minAreaRect(contour)
        corners = cv2.boxPoints(rect)
        # Measure the direction of the box's long edge directly; minAreaRect's own angle
        # convention differs between OpenCV versions.
        edges = [corners[1] - corners[0], corners[2] - corners[1]]
        long_edge, short_edge = sorted(edges, key=lambda edge: float(np.hypot(*edge)), reverse=True)
        length, thickness = float(np.hypot(*long_edge)), float(np.hypot(*short_edge))
        # Only long, thin shapes are likely to be lines of text.
        if length < 60 or length < 4 * thickness:
            continue
        angle = float(np.degrees(np.arctan2(long_edge[1], long_edge[0])))
        # Fold to (-90, 90]: a line's direction is the same either way along it.
        if angle <= -90:
            angle += 180
        elif angle > 90:
            angle -= 180
        if abs(angle) > 45:
            continue
        angles.append(angle)
        weights.append(length)

    if not angles:
        return 0.0
    # In image coordinates (y down) a line rising to the right has a negative angle, and
    # rotating counter-clockwise by that same negative angle levels it.
    return float(np.average(angles, weights=weights))


def correct_skew(image: Image) -> Image:
    angle = estimate_skew(image)
    if not MIN_SKEW_DEGREES <= abs(angle) <= MAX_SKEW_DEGREES:
        return image
    return rotate(image, angle)


def rotate(image: Image, angle: float) -> Image:
    """Rotate counter-clockwise by ``angle`` degrees, growing the canvas so nothing is cropped."""
    height, width = image.shape[:2]
    centre = (width / 2, height / 2)
    matrix = cv2.getRotationMatrix2D(centre, angle, 1.0)
    cos, sin = abs(matrix[0, 0]), abs(matrix[0, 1])
    new_width = int(height * sin + width * cos)
    new_height = int(height * cos + width * sin)
    matrix[0, 2] += new_width / 2 - centre[0]
    matrix[1, 2] += new_height / 2 - centre[1]
    return np.asarray(
        cv2.warpAffine(
            image,
            matrix,
            (new_width, new_height),
            flags=cv2.INTER_CUBIC,
            borderMode=cv2.BORDER_REPLICATE,
        ),
        dtype=np.uint8,
    )


def rotate_quarter_turns(image: Image, clockwise_degrees: int) -> Image:
    codes = {
        90: cv2.ROTATE_90_CLOCKWISE,
        180: cv2.ROTATE_180,
        270: cv2.ROTATE_90_COUNTERCLOCKWISE,
    }
    code = codes.get(clockwise_degrees % 360)
    return image if code is None else np.asarray(cv2.rotate(image, code), dtype=np.uint8)


def apply(image: Image, steps: Sequence[Step]) -> Image:
    for step in steps:
        image = step(image)
    return image


# The standard pipeline, followed by an optional binarised variant for difficult photos.
STANDARD_STEPS: tuple[Step, ...] = (resize_for_ocr, correct_skew, reduce_noise, enhance_contrast)
FALLBACK_STEPS: tuple[Step, ...] = (binarize,)
