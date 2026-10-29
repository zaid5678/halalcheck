"""Ingredient reading and analysis: build requests, parse the model's JSON, cross-check the
ingredient knowledge base, apply safeguards and attach curated Islamic evidence."""

import base64
import json
import logging
import re
import time
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError

from app.ai.openrouter import AiInvalidResponseError, OpenRouterClient
from app.ai.prompt import READ_PROMPT, SYSTEM_PROMPT, build_user_text
from app.ai.schema import strict_json_schema
from app.evidence import PROHIBITED_SOURCES, get_library
from app.models.analysis import (
    CitedEvidence,
    ConcernFinding,
    ConcernResult,
    IngredientFinding,
    IngredientResult,
    IngredientsAnalysis,
    KnowledgeBaseMatch,
    LabelAnalysis,
    LabelReading,
    LabelReadingResult,
    OverallStatus,
    ProhibitionReason,
    ScholarlyQualification,
    SourceEvidence,
)
from app.services.rules import lookup_terms

logger = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)

LABEL_SCHEMA = strict_json_schema(LabelAnalysis)
READING_SCHEMA = strict_json_schema(LabelReading)
_CODE_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)
_SEVERITY = {"halal": 0, "doubtful": 1, "haram": 2}

STATUS_NAMES: dict[str, str] = {
    "haram": "Haram",
    "likely_halal": "Likely halal",
    "potentially_non_halal": "Potentially non-halal",
    "needs_further_investigation": "Needs further investigation",
}


def _image_part(image_jpeg: bytes) -> dict[str, Any]:
    encoded = base64.b64encode(image_jpeg).decode("ascii")
    return {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{encoded}"}}


class IngredientsAnalyzer:
    def __init__(
        self,
        client: OpenRouterClient,
        model: str,
        structured_outputs: bool,
        reading_model: str | None = None,
    ) -> None:
        self._client = client
        self._model = model
        self._reading_model = reading_model or model
        self._structured_outputs = structured_outputs

    async def read(self, image_jpeg: bytes) -> LabelReadingResult:
        """Step 1: transcribe and interpret the label so the user can check it."""
        started = time.perf_counter()
        system = READ_PROMPT
        if not self._structured_outputs:
            system += "\n\nJSON schema:\n" + json.dumps(READING_SCHEMA)
        raw = await self._client.complete(
            [
                {"role": "system", "content": system},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "Read the ingredients label in this photo."},
                        _image_part(image_jpeg),
                    ],
                },
            ],
            schema=READING_SCHEMA if self._structured_outputs else None,
            schema_name="label_reading",
            model=self._reading_model,
            max_tokens=3000,
        )
        reading = parse_model_json(LabelReading, raw)
        logger.info(
            "Label read: %d ingredients, %d uncertain, languages %s, %.1fs",
            len(reading.ingredients),
            sum(item.reading_uncertain for item in reading.ingredients),
            reading.detected_languages,
            time.perf_counter() - started,
        )
        return LabelReadingResult(**reading.model_dump(), model=self._reading_model)

    async def analyze(
        self, *, image_jpeg: bytes | None, corrected_text: str | None
    ) -> IngredientsAnalysis:
        """Step 2: assess the (confirmed) ingredients."""
        started = time.perf_counter()
        content: list[dict[str, Any]] = [
            {"type": "text", "text": build_user_text(corrected_text, image_jpeg is not None)}
        ]
        if image_jpeg is not None:
            content.append(_image_part(image_jpeg))

        system = SYSTEM_PROMPT
        if not self._structured_outputs:
            # Without native structured outputs, spell the schema out in the instructions.
            system += "\n\nJSON schema:\n" + json.dumps(LABEL_SCHEMA)

        raw = await self._client.complete(
            [{"role": "system", "content": system}, {"role": "user", "content": content}],
            schema=LABEL_SCHEMA if self._structured_outputs else None,
        )
        label = parse_model_json(LabelAnalysis, raw)
        result = finalise_analysis(
            label, model=self._model, used_corrected_text=corrected_text is not None
        )
        logger.info(
            "Analysis finished: %s (%s confidence), %d ingredients, %d concerns, "
            "%d adjustment(s), %.1fs",
            result.overall_status,
            result.confidence,
            len(result.ingredients),
            len(result.identified_concerns),
            len(result.adjustments),
            time.perf_counter() - started,
        )
        return result


def parse_model_json(model: type[T], raw: str) -> T:
    """Parse the model's reply, tolerating code fences or text around the JSON object."""
    text = _CODE_FENCE.sub("", raw.strip())
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end <= start:
            logger.warning("Model reply contained no JSON object")
            raise AiInvalidResponseError() from None
        try:
            data = json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            logger.warning("Model reply was not valid JSON")
            raise AiInvalidResponseError() from None

    try:
        return model.model_validate(data)
    except ValidationError as exc:
        fields = sorted({".".join(str(p) for p in err["loc"]) for err in exc.errors()})
        logger.warning("Model reply failed validation: %s", ", ".join(fields[:10]))
        raise AiInvalidResponseError() from None


def parse_label_analysis(raw: str) -> LabelAnalysis:
    return parse_model_json(LabelAnalysis, raw)


# --- Knowledge base -------------------------------------------------------------------------


def knowledge_base_match(item: IngredientFinding) -> tuple[KnowledgeBaseMatch, str | None] | None:
    """Match an ingredient against the knowledge base via its English interpretation.

    Matching uses the translated name, standard identity, E-number and alternative names, so an
    ingredient written in Arabic or French is checked the same way as one written in English.
    Returns the most severe match and the principle it is linked to, if any.
    """
    names = [
        item.translated_name,
        item.standardised_identity,
        item.e_number,
        *item.alternative_names,
        item.original_text,
    ]
    matches = lookup_terms(" ; ".join(name for name in names if name))
    if not matches:
        return None
    # The most specific (longest) term wins, so "pork gelatine" beats "gelatine" and "halal beef
    # gelatine" beats "gelatine"; between equally specific terms, prefer the more cautious one.
    term, entry = max(matches, key=lambda pair: (len(pair[0]), _SEVERITY[pair[1]["ruling"]]))
    return (
        KnowledgeBaseMatch(term=term, ruling=entry["ruling"], note=entry["note"]),
        entry.get("principle"),
    )


# --- Safeguards and evidence ----------------------------------------------------------------


def _find_ingredient(items: list[IngredientResult], name: str) -> IngredientResult | None:
    key = name.casefold().strip()
    for item in items:
        if item.original_text.casefold().strip() == key:
            return item
    for item in items:
        names = [item.original_text, item.translated_name, item.standardised_identity]
        if any(n and (key in n.casefold() or n.casefold() in key) for n in names):
            return item
    return None


def _is_verified_prohibited(concern: ConcernFinding, item: IngredientResult | None) -> bool:
    """Both questions answered: a clear prohibition (A) and a label-established source (B)."""
    principle = get_library().principle(concern.principle_id)
    return bool(
        principle is not None
        and principle.category == "prohibited"
        and concern.concern_type == "established_prohibited_source"
        and concern.source_evidence_basis == "label"
        and item is not None
        and item.established_source in PROHIBITED_SOURCES.get(concern.principle_id, frozenset())
    )


def finalise_analysis(
    label: LabelAnalysis, *, model: str, used_corrected_text: bool
) -> IngredientsAnalysis:
    """Cross-check the knowledge base, enforce safeguards and attach curated evidence.

    Safeguards can only make the result more cautious, with one exception: a prohibited source
    that both the library and the label establish is reported as haram. Every change is recorded.
    """
    library = get_library()
    adjustments: list[str] = []
    ingredients: list[IngredientResult] = []
    kb_principles: dict[str, str] = {}

    for finding in label.ingredients:
        item = IngredientResult(**finding.model_dump())
        kb = knowledge_base_match(finding)
        if kb:
            item.knowledge_base_match, principle_id = kb
            ruling = item.knowledge_base_match.ruling
            if principle_id:
                kb_principles[item.original_text] = principle_id
            if ruling == "haram" and item.assessment != "potential_concern":
                item.assessment = "potential_concern"
                adjustments.append(
                    f"“{item.original_text}” matches “{item.knowledge_base_match.term}” in "
                    "HalalCheck’s ingredient knowledge base, so it is treated as a concern."
                )
            elif (
                ruling == "doubtful"
                and item.assessment == "likely_permissible"
                and item.established_source is None
            ):
                item.assessment = "unknown"
                item.needs_more_information = True
                adjustments.append(
                    f"“{item.original_text}” matches “{item.knowledge_base_match.term}” in "
                    f"HalalCheck’s ingredient knowledge base ({item.knowledge_base_match.note}), "
                    "and the label does not state its source, so its source is treated as unknown."
                )
        ingredients.append(item)

    # Concerns: only principles that exist in the library survive.
    concerns: list[ConcernResult] = []
    for concern in label.identified_concerns:
        principle = library.principle(concern.principle_id)
        if principle is None:
            adjustments.append(
                f"An AI-cited principle (“{concern.principle_id}”) that is not in HalalCheck’s "
                "verified evidence library was removed."
            )
            continue
        concerned_item = _find_ingredient(ingredients, concern.ingredient)
        concerns.append(
            ConcernResult(
                **concern.model_dump(),
                principle_title=principle.title,
                principle_category=principle.category,
                verified_prohibited_source=_is_verified_prohibited(concern, concerned_item),
            )
        )

    # Knowledge-base concerns the model missed are added as possible (not established) concerns.
    covered = {c.ingredient.casefold() for c in concerns}
    for item in ingredients:
        principle_id = kb_principles.get(item.original_text)
        kb_entry = item.knowledge_base_match
        if (
            principle_id
            and kb_entry
            and kb_entry.ruling == "haram"
            and (item.original_text.casefold() not in covered)
        ):
            principle = library.principle(principle_id)
            assert principle is not None
            concerns.append(
                ConcernResult(
                    ingredient=item.original_text,
                    principle_id=principle_id,
                    concern_type=(
                        "disputed_ingredient"
                        if principle.category == "disputed"
                        else "possible_prohibited_source"
                    ),
                    source_evidence=f"HalalCheck’s knowledge base: {kb_entry.note}.",
                    source_evidence_basis="general_knowledge",
                    connection=(
                        f"Identified as “{kb_entry.term}”, which HalalCheck’s knowledge base links "
                        f"to the principle “{principle.title}”."
                    ),
                    unresolved_question=None,
                    principle_title=principle.title,
                    principle_category=principle.category,
                    verified_prohibited_source=False,
                )
            )
            adjustments.append(
                f"“{item.original_text}” was added as a concern from HalalCheck’s ingredient "
                "knowledge base."
            )

    status = _decide_status(label, ingredients, concerns, adjustments)
    confidence = label.confidence
    if not label.label_readable and confidence == "high":
        confidence = "low"
        adjustments.append("Confidence was lowered because the label could not be read reliably.")

    verified = [c for c in concerns if c.verified_prohibited_source]
    reasons = (
        [_prohibition_reason(c, _find_ingredient(ingredients, c.ingredient)) for c in verified]
        if status == "haram"
        else []
    )

    # Principles whose evidence is shown: every concern, plus "doubtful matters" when sources
    # are unknown.
    cited: list[str] = list(dict.fromkeys(c.principle_id for c in concerns))
    if (
        status == "needs_further_investigation"
        or any(i.assessment == "unknown" or i.needs_more_information for i in ingredients)
    ) and "doubtful_matters" not in cited:
        cited.append("doubtful_matters")

    return IngredientsAnalysis(
        **label.model_dump(
            exclude={"overall_status", "confidence", "ingredients", "identified_concerns"}
        ),
        overall_status=status,
        confidence=confidence,
        ingredients=ingredients,
        identified_concerns=concerns,
        reason_for_prohibition=reasons,
        ingredient_source_evidence=_source_evidence(ingredients, concerns),
        islamic_evidence=_cited_evidence(cited),
        scholarly_qualifications=[
            ScholarlyQualification(
                principle_id=p.id,
                principle_title=p.title,
                category=p.category,
                notes=p.qualifications,
            )
            for p in (library.principle(pid) for pid in cited)
            if p is not None and p.qualifications
        ],
        model=model,
        used_corrected_text=used_corrected_text,
        adjustments=adjustments,
    )


def _decide_status(
    label: LabelAnalysis,
    ingredients: list[IngredientResult],
    concerns: list[ConcernResult],
    adjustments: list[str],
) -> OverallStatus:
    status: OverallStatus = label.overall_status

    def change(new_status: OverallStatus, reason: str) -> None:
        nonlocal status
        if status != new_status:
            adjustments.append(
                f"HalalCheck changed the overall result from “{STATUS_NAMES[status]}” to "
                f"“{STATUS_NAMES[new_status]}” because {reason}."
            )
            status = new_status

    if any(c.verified_prohibited_source for c in concerns):
        change(
            "haram",
            "the label establishes that an ingredient comes from a source the Qur'an prohibits",
        )
        return status

    if status == "haram":
        change(
            "potentially_non_halal",
            "no ingredient’s prohibited source is established by the label, so a definitive "
            "classification is not supported",
        )

    unknowns = [i for i in ingredients if i.assessment == "unknown" or i.needs_more_information]
    flagged = [i for i in ingredients if i.assessment == "potential_concern"]
    if status == "likely_halal":
        if not label.label_readable:
            change("needs_further_investigation", "the ingredients list could not be read reliably")
        elif not ingredients and not label.extracted_ingredients_text.strip():
            change("needs_further_investigation", "no ingredients could be identified")
        elif concerns or flagged:
            change("potentially_non_halal", "at least one ingredient was identified as a concern")
        elif unknowns:
            change(
                "needs_further_investigation",
                "the source of at least one ingredient is uncertain",
            )
    return status


def _prohibition_reason(concern: ConcernResult, item: IngredientResult | None) -> ProhibitionReason:
    library = get_library()
    principle = library.principle(concern.principle_id)
    assert principle is not None and item is not None and item.established_source is not None
    evidence = library.evidence_for(principle)
    return ProhibitionReason(
        ingredient_on_packaging=item.original_text,
        translated_name=item.translated_name,
        standardised_name=item.standardised_identity,
        source=item.established_source,
        source_evidence=concern.source_evidence,
        source_evidence_basis=concern.source_evidence_basis,
        principle_id=principle.id,
        principle_title=principle.title,
        why_prohibited=principle.principle,
        connection=concern.connection,
        evidence_ids=[e.id for e in evidence],
        has_verified_hadith=any(e.source_type == "hadith" for e in evidence),
        qualifications=principle.qualifications,
    )


def _source_evidence(
    ingredients: list[IngredientResult], concerns: list[ConcernResult]
) -> list[SourceEvidence]:
    concerned = {c.ingredient.casefold() for c in concerns}
    return [
        SourceEvidence(
            ingredient=item.original_text,
            standardised_identity=item.standardised_identity,
            possible_sources=item.possible_sources,
            established_source=item.established_source,
            evidence=item.evidence,
            evidence_basis=item.evidence_basis,
            knowledge_base_note=item.knowledge_base_match.note
            if item.knowledge_base_match
            else None,
        )
        for item in ingredients
        if item.assessment != "likely_permissible"
        or item.needs_more_information
        or item.original_text.casefold() in concerned
    ]


def _cited_evidence(principle_ids: list[str]) -> list[CitedEvidence]:
    library = get_library()
    cited: dict[str, CitedEvidence] = {}
    for principle_id in principle_ids:
        principle = library.principle(principle_id)
        if principle is None:
            continue
        for item in library.evidence_for(principle):
            entry = cited.get(item.id) or CitedEvidence(
                **item.model_dump(), principle_ids=[], notes=[]
            )
            entry.principle_ids.append(principle.id)
            note = principle.evidence_notes.get(item.id)
            if note and note not in entry.notes:
                entry.notes.append(note)
            cited[item.id] = entry
    return list(cited.values())
