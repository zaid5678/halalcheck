import pytest

from app.validation import InvalidInputError, normalise_barcode, normalise_query


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("12345678", "12345678"),
        ("0012345678905", "0012345678905"),
        ("5 000112 637922", "5000112637922"),
        ("036000-291452", "036000291452"),
    ],
)
def test_normalise_barcode_accepts_and_preserves_digits(raw: str, expected: str) -> None:
    assert normalise_barcode(raw) == expected


@pytest.mark.parametrize("raw", ["", "1234567", "123456789012345", "12a45678", "+12345678"])
def test_normalise_barcode_rejects(raw: str) -> None:
    with pytest.raises(InvalidInputError):
        normalise_barcode(raw)


def test_normalise_query_keeps_product_punctuation() -> None:
    assert normalise_query("Ben & Jerry's  Cookie-Dough") == "ben & jerry's cookie-dough"


def test_normalise_query_strips_control_characters() -> None:
    assert normalise_query("milk\x00\x1fchocolate") == "milkchocolate"


def test_cors_origins_are_normalised() -> None:
    from app.config import Settings

    settings = Settings(cors_origins=" https://Example.vercel.app/ , http://localhost:5173,, ")
    assert settings.cors_origins == ["https://example.vercel.app", "http://localhost:5173"]


def test_cors_origins_default_includes_production_site() -> None:
    from app.config import Settings

    assert "https://halalcheck-psi.vercel.app" in Settings.model_fields["cors_origins"].default
