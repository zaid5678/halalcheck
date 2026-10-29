"""Deterministic ingredient rulings. These are the source of truth; the LLM can only add to them."""

import json
import re
from pathlib import Path

from app.models.halal import Reason, Ruling

_RULINGS = json.loads((Path(__file__).parent.parent / "data" / "rulings.json").read_text("utf-8"))
_BY_TERM: dict[str, dict[str, str]] = {
    term.lower(): entry for entry in _RULINGS for term in entry["match"]
}
# Longest terms first, so "halal beef gelatine" wins over "gelatine".
_PATTERN = re.compile(
    r"(?<!\w)("
    + "|".join(re.escape(term) for term in sorted(_BY_TERM, key=len, reverse=True))
    + r")(?!\w)",
    re.IGNORECASE,
)
_E_NUMBER = re.compile(r"\bE[\s-]+(\d{3}[a-f]?)\b", re.IGNORECASE)
_SEVERITY: dict[Ruling, int] = {"halal": 0, "doubtful": 1, "haram": 2}


def check_ingredients(text: str) -> list[Reason]:
    """Haram and doubtful ingredients found in `text`, each reported once."""
    reasons: dict[str, Reason] = {}
    for match in _PATTERN.finditer(_E_NUMBER.sub(r"E\1", text)):
        term = match.group(1).lower()
        entry = _BY_TERM[term]
        if entry["ruling"] != "halal" and term not in reasons:
            reasons[term] = Reason(
                ingredient=match.group(1), ruling=entry["ruling"], note=entry["note"]
            )
    return list(reasons.values())


def overall_verdict(reasons: list[Reason]) -> Ruling:
    return max((r.ruling for r in reasons), key=_SEVERITY.__getitem__, default="halal")
