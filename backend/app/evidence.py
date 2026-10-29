"""The curated Islamic evidence library (data/islamic_evidence.json).

Every Qur'an verse and hadith shown to users comes from this file, whose text, references and
gradings were checked against Quran.com/AlQuran Cloud and Sunnah.com. The AI can only point to
principles by id; it never supplies quotations or references itself.
"""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, model_validator

_PATH = Path(__file__).parent / "data" / "islamic_evidence.json"

PrincipleCategory = Literal["prohibited", "disputed", "caution"]


class Authenticity(BaseModel):
    grade: str
    graded_by: str


class EvidenceItem(BaseModel):
    model_config = ConfigDict(frozen=True)

    id: str
    source_type: Literal["quran", "hadith"]
    reference: str
    title: str
    narrator: str | None = None
    arabic_text: str
    translation: str
    translation_source: str
    text_source: str
    authenticity: Authenticity | None
    url: str
    excerpt: bool

    @model_validator(mode="after")
    def _hadith_has_grading(self) -> "EvidenceItem":
        if self.source_type == "hadith" and self.authenticity is None:
            raise ValueError(f"{self.id}: hadith must record its grading")
        if not self.url.startswith(("https://quran.com/", "https://sunnah.com/")):
            raise ValueError(f"{self.id}: unexpected source URL {self.url}")
        return self


class Principle(BaseModel):
    id: str
    category: PrincipleCategory
    title: str
    principle: str
    evidence_ids: list[str]
    evidence_notes: dict[str, str]
    qualifications: list[str]


class EvidenceLibrary(BaseModel):
    about: str
    retrieved: str
    evidence: list[EvidenceItem]
    principles: list[Principle]

    @model_validator(mode="after")
    def _references_resolve(self) -> "EvidenceLibrary":
        ids = {item.id for item in self.evidence}
        for principle in self.principles:
            missing = (set(principle.evidence_ids) | set(principle.evidence_notes)) - ids
            if missing:
                raise ValueError(f"{principle.id} references unknown evidence {sorted(missing)}")
        return self

    def principle(self, principle_id: str) -> Principle | None:
        return next((p for p in self.principles if p.id == principle_id), None)

    def item(self, evidence_id: str) -> EvidenceItem:
        return next(item for item in self.evidence if item.id == evidence_id)

    def evidence_for(self, principle: Principle) -> list[EvidenceItem]:
        return [self.item(evidence_id) for evidence_id in principle.evidence_ids]

    @property
    def principle_ids(self) -> list[str]:
        return [p.id for p in self.principles]


@lru_cache
def get_library() -> EvidenceLibrary:
    return EvidenceLibrary.model_validate_json(_PATH.read_text("utf-8"))


class PrincipleExplanation(BaseModel):
    """A curated principle with its verified evidence, ready to show to users."""

    principle_id: str
    title: str
    category: PrincipleCategory
    principle: str
    evidence: list[EvidenceItem]
    evidence_notes: dict[str, str]
    qualifications: list[str]
    has_verified_hadith: bool


def explain(principle_id: str) -> PrincipleExplanation | None:
    library = get_library()
    principle = library.principle(principle_id)
    if principle is None:
        return None
    evidence = library.evidence_for(principle)
    return PrincipleExplanation(
        principle_id=principle.id,
        title=principle.title,
        category=principle.category,
        principle=principle.principle,
        evidence=evidence,
        evidence_notes=principle.evidence_notes,
        qualifications=principle.qualifications,
        has_verified_hadith=any(item.source_type == "hadith" for item in evidence),
    )


# Which established ingredient sources fall under each prohibition (question B). A prohibited
# finding only becomes a definitive "haram" result when the label establishes one of these.
# "carrion" and "dedicated_to_other_than_allah" are empty on purpose: a label stating "beef" or
# "chicken" establishes the animal, not how it was slaughtered, so those need confirmation.
PROHIBITED_SOURCES: dict[str, frozenset[str]] = {
    "swine": frozenset({"pork"}),
    "intoxicants": frozenset({"alcohol"}),
    "blood": frozenset({"animal", "pork"}),
    "carrion": frozenset(),
    "dedicated_to_other_than_allah": frozenset(),
}


def principle_ids() -> list[str]:
    return get_library().principle_ids
