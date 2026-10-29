"""Models for AI ingredient analysis.

``LabelAnalysis`` is what the vision model must return (it is also turned into the JSON schema
sent to OpenRouter). ``IngredientsAnalysis`` is the API response: the model's analysis after
HalalCheck's own safeguards have been applied.
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

OverallStatus = Literal["likely_halal", "potentially_non_halal", "needs_further_investigation"]
Assessment = Literal["likely_permissible", "potential_concern", "unknown"]
Confidence = Literal["low", "medium", "high"]
SourceType = Literal[
    "pork",
    "animal",
    "insect",
    "plant",
    "mineral",
    "synthetic",
    "microbial",
    "alcohol",
    "unknown",
]
# Where a statement comes from. There is no external verification step, so the model can only
# rely on what is printed on the label or on its own general knowledge.
EvidenceBasis = Literal["label", "general_knowledge"]

_SOURCE_VALUES: frozenset[str] = frozenset(SourceType.__args__)  # type: ignore[attr-defined]


def _normalise_enum(value: Any) -> Any:
    """Accept harmless variations such as "Likely Halal" or "potential-concern"."""
    if isinstance(value, str):
        return value.strip().lower().replace("-", "_").replace(" ", "_")
    return value


class _Strict(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


class IngredientFinding(_Strict):
    original_text: str = Field(description="The ingredient exactly as printed on the label.")
    standardised_name: str | None = Field(
        description="Common English or standard name, if known. Null if not applicable."
    )
    translation: str | None = Field(
        description="English translation when the label is not in English, otherwise null."
    )
    e_number: str | None = Field(
        description="E-number or INS code only if printed or unambiguously identified, else null."
    )
    possible_sources: list[SourceType] = Field(
        description="Raw-material sources this ingredient is known to come from."
    )
    source_established: bool = Field(
        description="True only if the label itself establishes which source was used."
    )
    assessment: Assessment
    explanation: str = Field(description="Why this assessment was given, in plain language.")
    evidence: str = Field(description="The specific evidence the explanation relies on.")
    evidence_basis: EvidenceBasis = Field(
        description="'label' if the evidence is printed on the label, else 'general_knowledge'."
    )
    needs_more_information: bool

    @field_validator("assessment", "evidence_basis", mode="before")
    @classmethod
    def _normalise(cls, value: Any) -> Any:
        return _normalise_enum(value)

    @field_validator("possible_sources", mode="before")
    @classmethod
    def _normalise_sources(cls, value: Any) -> Any:
        if not isinstance(value, list):
            return value
        sources = [_normalise_enum(item) for item in value]
        # Unrecognised source labels become "unknown" rather than failing the whole analysis.
        return list(dict.fromkeys(s if s in _SOURCE_VALUES else "unknown" for s in sources))


class ProhibitedFinding(_Strict):
    """An ingredient the label clearly identifies as coming from a prohibited source."""

    ingredient: str = Field(description="Ingredient as printed on the label.")
    source: str = Field(description="The prohibited source, e.g. pork.")
    evidence: str = Field(description="What on the label establishes this source.")


class Concern(_Strict):
    ingredient: str | None = Field(description="Related ingredient as printed, or null.")
    description: str


class CertificationInformation(_Strict):
    marks_visible: list[str] = Field(
        description="Halal certification marks or statements visible in the photo, as seen."
    )
    notes: str = Field(
        description="What can and cannot be concluded from the visible marks. Never assume a "
        "mark is authentic."
    )


class LabelAnalysis(_Strict):
    label_readable: bool = Field(
        description="False if the ingredients list is too blurry, cut off or unreadable to assess."
    )
    readability_notes: str | None = Field(
        description="If unreadable or partly unreadable, what is wrong and how to retake the photo."
    )
    detected_language: list[str] = Field(description="Languages of the ingredients text.")
    extracted_ingredients_text: str = Field(
        description="The full ingredients list as read from the label, in its original language."
    )
    overall_status: OverallStatus
    confidence: Confidence
    summary: str
    ingredients: list[IngredientFinding]
    prohibited_findings: list[ProhibitedFinding]
    concerns: list[Concern]
    certification_information: CertificationInformation
    limitations: list[str]
    next_steps: list[str]

    @field_validator("overall_status", "confidence", mode="before")
    @classmethod
    def _normalise(cls, value: Any) -> Any:
        return _normalise_enum(value)


class IngredientsAnalysis(LabelAnalysis):
    """API response: the model's analysis plus HalalCheck's safeguards."""

    model: str = Field(description="OpenRouter model that produced the analysis.")
    used_corrected_text: bool = Field(
        description="True when the user's corrected ingredients text was used."
    )
    adjustments: list[str] = Field(
        default_factory=list,
        description="Changes HalalCheck made to the model's result, and why.",
    )
