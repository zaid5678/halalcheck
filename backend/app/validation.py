"""Input validation and sanitisation for user-supplied search queries and barcodes."""

import re
import unicodedata

# EAN-8, UPC-A (12), EAN-13 and GTIN-14. Barcodes are always handled as strings so that
# leading zeros survive.
BARCODE_PATTERN = re.compile(r"^\d{8,14}$")

QUERY_MIN_LENGTH = 2
QUERY_MAX_LENGTH = 100

# Anything outside word characters, whitespace and a few punctuation marks common in product
# names is removed. This also strips query-syntax characters (: " ( ) * ? etc.) that the search
# service would otherwise interpret.
_DISALLOWED_QUERY_CHARS = re.compile(r"[^\w\s'&.-]", re.UNICODE)
_LEADING_HYPHENS = re.compile(r"(^|\s)-+")
_WHITESPACE = re.compile(r"\s+")


class InvalidInputError(ValueError):
    """Raised when user input cannot be used to query the data source."""


def normalise_barcode(raw: str) -> str:
    barcode = re.sub(r"[\s-]", "", raw)
    if not BARCODE_PATTERN.fullmatch(barcode):
        raise InvalidInputError("A barcode must contain 8 to 14 digits.")
    return barcode


def normalise_query(raw: str) -> str:
    text = unicodedata.normalize("NFKC", raw)
    text = "".join(ch for ch in text if unicodedata.category(ch)[0] != "C")
    text = _DISALLOWED_QUERY_CHARS.sub(" ", text)
    text = _LEADING_HYPHENS.sub(" ", text)
    # Lowercasing neutralises boolean operators (AND/OR/NOT); search is case-insensitive anyway.
    text = _WHITESPACE.sub(" ", text).strip().lower()
    if len(text) < QUERY_MIN_LENGTH:
        raise InvalidInputError(
            f"Search terms must be at least {QUERY_MIN_LENGTH} characters long."
        )
    if len(text) > QUERY_MAX_LENGTH:
        raise InvalidInputError(f"Search terms must be at most {QUERY_MAX_LENGTH} characters.")
    return text
