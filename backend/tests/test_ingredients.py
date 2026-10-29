import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.config import get_settings
from app.ocr.engine import OcrResult, OcrWord
from app.ocr.errors import OcrFailedError, OcrTimeoutError, OcrUnavailableError
from tests.conftest import FakeOcrEngine, encode, make_label, words

URL = "/api/ingredients/extract"
LABEL = make_label(["Ingredients: sugar, gelatine (beef)"])


def upload(
    client: TestClient, data: bytes, content_type: str = "image/jpeg", name: str = "label.jpg"
):  # type: ignore[no-untyped-def]
    return client.post(URL, files={"image": (name, data, content_type)})


# --- Successful extraction ------------------------------------------------------------------


def test_extracts_text_with_confidence(client: TestClient, ocr_engine: FakeOcrEngine) -> None:
    ocr_engine.results = [
        OcrResult(
            words=words("Ingredients: sugar, palm oil,", 96)
            + words("gelatine (beef), salt.", 90, line=2)
        )
    ]

    response = upload(client, encode(LABEL))

    assert response.status_code == 200
    assert response.json() == {
        "text": "Ingredients: sugar, palm oil,\ngelatine (beef), salt.",
        "confidence": 93.4,
        "word_count": 7,
        "uncertain_words": [],
        "low_confidence": False,
    }
    # Only one OCR pass is needed when the first result is good.
    assert len(ocr_engine.images) == 1
    assert ocr_engine.rotation_checks == 0


@pytest.mark.parametrize(
    ("image_format", "content_type"),
    [("JPEG", "image/jpeg"), ("PNG", "image/png"), ("WEBP", "image/webp")],
)
def test_accepts_supported_formats(
    client: TestClient, ocr_engine: FakeOcrEngine, image_format: str, content_type: str
) -> None:
    ocr_engine.results = [OcrResult(words=words("sugar salt water flour yeast"))]

    response = upload(client, encode(LABEL, image_format), content_type)

    assert response.status_code == 200


def test_trusts_file_contents_over_generic_content_type(
    client: TestClient, ocr_engine: FakeOcrEngine
) -> None:
    ocr_engine.results = [OcrResult(words=words("sugar salt water flour yeast"))]

    response = upload(client, encode(LABEL), "application/octet-stream", "blob")

    assert response.status_code == 200


def test_reports_uncertain_words_and_low_confidence(
    client: TestClient, ocr_engine: FakeOcrEngine
) -> None:
    ocr_engine.results = [
        OcrResult(
            words=[
                OcrWord("Ingredients:", 92),
                OcrWord("sugar,", 40),
                OcrWord("gelatlne", 35),
                OcrWord("Sugar,", 38),
                OcrWord("|", 10),
            ]
        )
    ]

    body = upload(client, encode(LABEL)).json()

    assert body["uncertain_words"] == ["sugar,", "gelatlne"]
    assert body["low_confidence"] is True
    # Stray punctuation doesn't count as a word, and the text is returned unaltered.
    assert body["word_count"] == 4
    assert body["text"] == "Ingredients: sugar, gelatlne Sugar, |"


def test_retries_with_rotation_and_binarisation_when_first_pass_is_poor(
    client: TestClient, ocr_engine: FakeOcrEngine
) -> None:
    ocr_engine.rotation = 90
    ocr_engine.results = [
        OcrResult(words=[OcrWord("~~a", 20)]),
        OcrResult(words=words("Ingredients: sugar, gelatine (beef)", 70)),
        OcrResult(words=words("Ingredients: sugar, gelatine (beef), salt", 88)),
    ]

    body = upload(client, encode(LABEL)).json()

    assert ocr_engine.rotation_checks == 1
    assert len(ocr_engine.images) == 3
    # The rotation turned the landscape label portrait.
    first, rotated = ocr_engine.images[0], ocr_engine.images[1]
    assert rotated.shape == (first.shape[1], first.shape[0])
    assert body["text"] == "Ingredients: sugar, gelatine (beef), salt"


def test_keeps_best_attempt(client: TestClient, ocr_engine: FakeOcrEngine) -> None:
    ocr_engine.results = [
        OcrResult(words=words("Ingredients: sugar, gelatine", 70)),
        OcrResult(words=[OcrWord("x", 15)]),
    ]

    body = upload(client, encode(LABEL)).json()

    assert body["text"] == "Ingredients: sugar, gelatine"


# --- Unreadable images and OCR failures -----------------------------------------------------


def test_empty_ocr_result(client: TestClient, ocr_engine: FakeOcrEngine) -> None:
    ocr_engine.results = [OcrResult(words=[])]

    response = upload(client, encode(LABEL))

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "no_text_found"


def test_only_punctuation_counts_as_no_text(client: TestClient, ocr_engine: FakeOcrEngine) -> None:
    ocr_engine.results = [OcrResult(words=[OcrWord("|", 30), OcrWord("~", 20)])]

    response = upload(client, encode(LABEL))

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "no_text_found"


@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (OcrUnavailableError(), 503, "ocr_unavailable"),
        (OcrFailedError(), 500, "ocr_failed"),
        (OcrTimeoutError(), 504, "ocr_timeout"),
    ],
)
def test_ocr_failures(
    client: TestClient, ocr_engine: FakeOcrEngine, error: Exception, status: int, code: str
) -> None:
    ocr_engine.results = [error]

    response = upload(client, encode(LABEL))

    assert response.status_code == status
    assert response.json()["error"]["code"] == code


# --- Upload validation ----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("content_type", "name"),
    [("text/plain", "notes.txt"), ("application/pdf", "label.pdf"), ("image/gif", "a.gif")],
)
def test_rejects_unsupported_content_types(
    client: TestClient, ocr_engine: FakeOcrEngine, content_type: str, name: str
) -> None:
    response = upload(client, encode(LABEL), content_type, name)

    assert response.status_code == 415
    assert response.json()["error"]["code"] == "unsupported_image_type"
    assert ocr_engine.images == []


def test_rejects_files_that_are_not_really_images(client: TestClient) -> None:
    response = upload(client, b"%PDF-1.7 pretending to be a jpeg", "image/jpeg")

    assert response.status_code == 415
    assert response.json()["error"]["code"] == "unsupported_image_type"


def test_rejects_gif_disguised_as_png(client: TestClient) -> None:
    response = upload(client, encode(LABEL, "GIF"), "image/png")

    assert response.status_code == 415


def test_rejects_corrupt_images(client: TestClient) -> None:
    truncated = encode(LABEL)[:200]

    response = upload(client, truncated)

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_image"


def test_rejects_tiny_images(client: TestClient) -> None:
    response = upload(client, encode(Image.new("RGB", (20, 20), "white")))

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_image"
    assert "too small" in response.json()["error"]["message"]


def test_rejects_images_with_too_many_pixels(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(get_settings(), "ocr_max_image_pixels", 100_000)

    response = upload(client, encode(LABEL))

    assert response.status_code == 400
    assert "too many pixels" in response.json()["error"]["message"]


def test_rejects_large_uploads(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "ocr_max_upload_bytes", 1024)

    response = upload(client, encode(LABEL))

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "image_too_large"


def test_rejects_large_uploads_without_content_length(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The streaming size check still applies if the Content-Length check is bypassed."""
    monkeypatch.setattr(get_settings(), "ocr_max_upload_bytes", 1024)
    data = encode(LABEL)
    boundary = "boundary123"
    body = (
        (
            f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="a.jpg"\r\n'
            "Content-Type: image/jpeg\r\n\r\n"
        ).encode()
        + data
        + f"\r\n--{boundary}--\r\n".encode()
    )

    def chunks():  # type: ignore[no-untyped-def]
        yield body

    response = client.post(
        URL, content=chunks(), headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}
    )

    assert response.status_code == 413


def test_rejects_empty_files(client: TestClient) -> None:
    response = upload(client, b"")

    assert response.status_code == 400
    assert response.json()["error"]["message"] == "The uploaded file is empty."


def test_requires_an_image_field(client: TestClient) -> None:
    response = client.post(URL, files={"photo": ("a.jpg", encode(LABEL), "image/jpeg")})

    assert response.status_code == 400
    assert response.json()["error"]["message"] == "Please choose an image to upload."


def test_short_fragments_are_not_listed_as_uncertain_words(
    client: TestClient, ocr_engine: FakeOcrEngine
) -> None:
    ocr_engine.results = [
        OcrResult(words=words("Ingredients: sugar, salt, water", 95) + [OcrWord("es", 20)])
    ]

    body = upload(client, encode(LABEL)).json()

    assert body["uncertain_words"] == []
