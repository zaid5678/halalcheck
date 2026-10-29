"""Models for AI ingredient analysis.

``LabelReading`` and ``LabelAnalysis`` are what the vision model must return (each is also turned
into the JSON schema sent to OpenRouter). ``IngredientsAnalysis`` is the API response: the
model's analysis after HalalCheck's safeguards, knowledge-base cross-check and curated Islamic
evidence have been applied.
"""

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.evidence import EvidenceItem, PrincipleCategory, principle_ids
from app.models.halal import Ruling

OverallStatus = Literal[
    "haram", "potentially_non_halal", "needs_further_investigation", "likely_halal"
]
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
ConcernType = Literal[
    "established_prohibited_source", "possible_prohibited_source", "disputed_ingredient"
]
# The model may only cite principles that exist in the curated evidence library.
PrincipleId = Annotated[str, Field(json_schema_extra={"enum": principle_ids()})]

_SOURCE_VALUES: frozenset[str] = frozenset(SourceType.__args__)  # type: ignore[attr-defined]


def _normalise_enum(value: Any) -> Any:
    """Accept harmless variations such as "Likely Halal" or "potential-concern"."""
    if isinstance(value, str):
        return value.strip().lower().replace("-", "_").replace(" ", "_")
    return value


def _normalise_source(value: Any) -> Any:
    value = _normalise_enum(value)
    return value if value is None or value in _SOURCE_VALUES else "unknown"


class _Strict(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


# --- Step 1: reading the label ---------------------------------------------------------------


class ReadIngredient(_Strict):
    original_text: str = Field(description="The ingredient exactly as printed, original script.")
    translated_name: str | None = Field(
        description="English name. Null only if it cannot be translated with confidence."
    )
    e_number: str | None = Field(
        description="E-number/INS code if printed or unambiguous for this exact name, else null."
    )
    alternative_names: list[str] = Field(
        description="Known synonyms, scientific or chemical names and transliterations that "
        "identify this ingredient. Empty if none are known with confidence."
    )
    reading_uncertain: bool = Field(
        description="True if the text may be misread or the translation is uncertain."
    )
    reading_note: str | None = Field(description="What is uncertain, if anything.")


class LabelReading(_Strict):
    label_readable: bool = Field(
        description="False if the ingredients list is too blurry, cut off or unreadable."
    )
    readability_notes: str | None = Field(
        description="What is wrong with the photo and how to retake it, if relevant."
    )
    clarification_request: str | None = Field(
        description="A specific question for the user when part of the label is ambiguous, "
        "e.g. which of two possible words is printed. Null if nothing needs clarifying."
    )
    detected_languages: list[str]
    ingredients_text: str = Field(
        description="The full ingredients list exactly as printed, in its original language."
    )
    ingredients: list[ReadIngredient]


# --- Step 2: analysing the ingredients -------------------------------------------------------


class IngredientFinding(_Strict):
    original_text: str = Field(description="The ingredient exactly as printed on the label.")
    translated_name: str | None = Field(
        description="English translation when the label is not in English, otherwise null."
    )
    standardised_identity: str | None = Field(
        description="The standard identity of the substance, e.g. 'Mono- and diglycerides of "
        "fatty acids'. Null if unknown."
    )
    alternative_names: list[str] = Field(
        description="Synonyms, scientific/chemical names or transliterations recognised."
    )
    e_number: str | None = Field(
        description="E-number or INS code only if printed or unambiguously identified, else null."
    )
    reading_uncertain: bool = Field(
        description="True if the label text or its translation may be wrong."
    )
    possible_sources: list[SourceType] = Field(
        description="Raw-material sources this ingredient is known to come from."
    )
    established_source: SourceType | None = Field(
        description="The source, only if the label itself establishes it (e.g. 'pork gelatine', "
        "'lard', 'beef fat', 'wine'). Null when the label does not say."
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

    @field_validator("established_source", mode="before")
    @classmethod
    def _normalise_established(cls, value: Any) -> Any:
        return _normalise_source(value)

    @field_validator("possible_sources", mode="before")
    @classmethod
    def _normalise_sources(cls, value: Any) -> Any:
        if not isinstance(value, list):
            return value
        # Unrecognised source labels become "unknown" rather than failing the whole analysis.
        return list(dict.fromkeys(_normalise_source(item) for item in value))


class ConcernFinding(_Strict):
    ingredient: str = Field(description="The ingredient exactly as printed on the label.")
    principle_id: PrincipleId = Field(
        description="The Islamic principle from HalalCheck's evidence library that this concern "
        "relates to (question A)."
    )
    concern_type: ConcernType
    source_evidence: str = Field(
        description="What establishes or suggests this ingredient's source (question B)."
    )
    source_evidence_basis: EvidenceBasis
    connection: str = Field(
        description="How the principle applies to this specific ingredient, without quoting or "
        "citing any text."
    )
    unresolved_question: str | None = Field(
        description="What would need to be confirmed to resolve this concern, if anything."
    )

    @field_validator("concern_type", "source_evidence_basis", "principle_id", mode="before")
    @classmethod
    def _normalise(cls, value: Any) -> Any:
        return _normalise_enum(value)


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
    detected_languages: list[str] = Field(description="Languages of the ingredients text.")
    extracted_ingredients_text: str = Field(
        description="The full ingredients list in its original language."
    )
    overall_status: OverallStatus
    confidence: Confidence
    summary: str
    ingredients: list[IngredientFinding]
    identified_concerns: list[ConcernFinding]
    certification_status: CertificationInformation
    unresolved_questions: list[str]
    recommended_next_steps: list[str]
    limitations: list[str]

    @field_validator("overall_status", "confidence", mode="before")
    @classmethod
    def _normalise(cls, value: Any) -> Any:
        return _normalise_enum(value)


# --- API response ----------------------------------------------------------------------------


class KnowledgeBaseMatch(BaseModel):
    term: str = Field(description="The knowledge-base term that matched this ingredient.")
    ruling: Ruling
    note: str


class IngredientResult(IngredientFinding):
    knowledge_base_match: KnowledgeBaseMatch | None = Field(
        default=None,
        description="HalalCheck's ingredient knowledge base entry matched via the English "
        "interpretation, E-number or alternative names.",
    )


class ConcernResult(ConcernFinding):
    principle_title: str
    principle_category: PrincipleCategory
    verified_prohibited_source: bool = Field(
        description="True only when the principle is a clear prohibition and the label itself "
        "establishes that this ingredient comes from the prohibited source."
    )


class ProhibitionReason(BaseModel):
    """Why a product is assessed as haram: one entry per verified prohibited ingredient."""

    ingredient_on_packaging: str
    translated_name: str | None
    standardised_name: str | None
    source: SourceType
    source_evidence: str
    source_evidence_basis: EvidenceBasis
    principle_id: str
    principle_title: str
    why_prohibited: str = Field(description="Curated statement of the Islamic principle.")
    connection: str = Field(description="AI-written link between the principle and ingredient.")
    evidence_ids: list[str] = Field(description="Entries in islamic_evidence supporting this.")
    has_verified_hadith: bool
    qualifications: list[str]


class SourceEvidence(BaseModel):
    ingredient: str
    standardised_identity: str | None
    possible_sources: list[SourceType]
    established_source: SourceType | None
    evidence: str
    evidence_basis: EvidenceBasis
    knowledge_base_note: str | None


class ScholarlyQualification(BaseModel):
    principle_id: str
    principle_title: str
    category: PrincipleCategory
    notes: list[str]


class CitedEvidence(EvidenceItem):
    principle_ids: list[str] = Field(description="Principles in this result that cite this item.")
    notes: list[str] = Field(description="Curated notes on how this text relates to them.")


class IngredientsAnalysis(LabelAnalysis):
    """API response: the model's analysis plus HalalCheck's safeguards and curated evidence."""

    ingredients: list[IngredientResult]  # type: ignore[assignment]
    identified_concerns: list[ConcernResult]  # type: ignore[assignment]
    reason_for_prohibition: list[ProhibitionReason] = Field(
        default_factory=list, description="Present only when overall_status is 'haram'."
    )
    ingredient_source_evidence: list[SourceEvidence] = Field(default_factory=list)
    islamic_evidence: list[CitedEvidence] = Field(
        default_factory=list, description="Verified entries from the curated evidence library."
    )
    scholarly_qualifications: list[ScholarlyQualification] = Field(default_factory=list)
    model: str = Field(description="OpenRouter model that produced the analysis.")
    used_corrected_text: bool = Field(
        description="True when the user's confirmed or corrected ingredients text was used."
    )
    adjustments: list[str] = Field(
        default_factory=list,
        description="Changes HalalCheck made to the model's result, and why.",
    )


class LabelReadingResult(LabelReading):
    model: str
