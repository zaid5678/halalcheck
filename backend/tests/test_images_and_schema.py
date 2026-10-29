import io
from typing import Any

import pytest
from PIL import Image

from app.ai.analysis import LABEL_SCHEMA
from app.images import InvalidImageError, UnsupportedImageTypeError, prepare_image, sniff_format
from tests.conftest import encode, make_label

PREPARE = {"max_pixels": 10**8, "max_edge": 2048}


def test_sniff_format() -> None:
    label = make_label(["x"])
    assert sniff_format(encode(label, "JPEG")) == "JPEG"
    assert sniff_format(encode(label, "PNG")) == "PNG"
    assert sniff_format(encode(label, "WEBP")) == "WEBP"
    assert sniff_format(encode(label, "GIF")) is None
    assert sniff_format(b"") is None


def test_prepare_image_rotates_and_strips_metadata() -> None:
    image = Image.new("RGB", (400, 200), "white")
    exif = Image.Exif()
    exif[0x0112] = 6  # "Rotate 90 CW to display": how phones store portrait photos.
    exif[0x010F] = "PhoneMaker"  # Device metadata must not reach the model.

    prepared = Image.open(io.BytesIO(prepare_image(encode(image, exif=exif), **PREPARE)))

    assert prepared.size == (200, 400)
    assert prepared.format == "JPEG"
    assert not prepared.getexif()


def test_prepare_image_downscales_large_photos() -> None:
    large = Image.new("RGB", (4000, 3000), "white")

    prepared = Image.open(io.BytesIO(prepare_image(encode(large), **PREPARE)))

    assert prepared.size == (2048, 1536)


def test_prepare_image_keeps_small_photos() -> None:
    small = Image.new("RGB", (800, 600), "white")

    prepared = Image.open(io.BytesIO(prepare_image(encode(small), **PREPARE)))

    assert prepared.size == (800, 600)


def test_prepare_image_puts_transparency_on_white() -> None:
    transparent = Image.new("RGBA", (100, 100), (0, 0, 0, 0))

    prepared = Image.open(io.BytesIO(prepare_image(encode(transparent, "PNG"), **PREPARE)))

    assert prepared.convert("L").getextrema()[0] > 250


def test_prepare_image_rejects_unknown_bytes() -> None:
    with pytest.raises(UnsupportedImageTypeError):
        prepare_image(b"hello world", **PREPARE)


def test_prepare_image_rejects_too_many_pixels() -> None:
    with pytest.raises(InvalidImageError, match="too many pixels"):
        prepare_image(encode(make_label(["x"])), max_pixels=1000, max_edge=2048)


def test_prepare_image_rejects_corrupt_png() -> None:
    data = encode(make_label(["x"]), "PNG")

    with pytest.raises(InvalidImageError):
        prepare_image(data[:60] + b"\x00" * 200, **PREPARE)


def _walk(node: Any) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    if isinstance(node, dict):
        found.append(node)
        for value in node.values():
            found.extend(_walk(value))
    elif isinstance(node, list):
        for item in node:
            found.extend(_walk(item))
    return found


def test_label_schema_is_strict_compatible() -> None:
    nodes = _walk(LABEL_SCHEMA)
    assert not any("$ref" in node or "$defs" in node for node in nodes)
    assert not any("title" in node or "default" in node for node in nodes)
    objects = [node for node in nodes if node.get("type") == "object"]
    assert objects
    for node in objects:
        assert node["additionalProperties"] is False
        assert set(node["required"]) == set(node["properties"])


def test_label_schema_lists_the_overall_statuses() -> None:
    assert LABEL_SCHEMA["properties"]["overall_status"]["enum"] == [
        "haram",
        "potentially_non_halal",
        "needs_further_investigation",
        "likely_halal",
    ]
    finding = LABEL_SCHEMA["properties"]["ingredients"]["items"]["properties"]
    assert finding["assessment"]["enum"] == ["likely_permissible", "potential_concern", "unknown"]


def test_concern_principles_are_limited_to_the_library() -> None:
    concern = LABEL_SCHEMA["properties"]["identified_concerns"]["items"]["properties"]
    assert concern["principle_id"]["enum"] == [
        "swine",
        "carrion",
        "blood",
        "intoxicants",
        "dedicated_to_other_than_allah",
        "insects",
        "doubtful_matters",
    ]
