import pytest

from app.services.open_food_facts import is_halal_related
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


@pytest.mark.parametrize(
    ("label", "expected"),
    [
        ("Halal", True),
        ("HALAL certified", True),
        ("Contrôle de la mosquée de Lyon", True),
        ("IFANCA", True),
        ("Vegetarian", False),
        ("No gluten", False),
        ("Chameleon", False),
    ],
)
def test_is_halal_related(label: str, expected: bool) -> None:
    assert is_halal_related(label) is expected
