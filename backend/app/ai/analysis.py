"""Ingredient analysis: build the request, parse the model's JSON and apply safeguards."""

import base64
import json
import logging
import re
import time
from typing import Any

from pydantic import ValidationError

from app.ai.openrouter import AiInvalidResponseError, OpenRouterClient
from app.ai.prompt import SYSTEM_PROMPT, build_user_text
from app.ai.schema import strict_json_schema
from app.models.analysis import IngredientsAnalysis, LabelAnalysis

logger = logging.getLogger(__name__)

LABEL_SCHEMA = strict_json_schema(LabelAnalysis)
_CODE_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)

STATUS_NAMES = {
    "likely_halal": "Likely halal",
    "potentially_non_halal": "Potentially non-halal",
    "needs_further_investigation": "Needs further investigation",
}


class IngredientsAnalyzer:
    def __init__(self, client: OpenRouterClient, model: str, structured_outputs: bool) -> None:
        self._client = client
        self._model = model
        self._structured_outputs = structured_outputs

    async def analyze(
        self, *, image_jpeg: bytes | None, corrected_text: str | None
    ) -> IngredientsAnalysis:
        started = time.perf_counter()
        content: list[dict[str, Any]] = [
            {"type": "text", "text": build_user_text(corrected_text, image_jpeg is not None)}
        ]
        if image_jpeg is not None:
            encoded = base64.b64encode(image_jpeg).decode("ascii")
            content.append(
                {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{encoded}"}}
            )

        system = SYSTEM_PROMPT
        if not self._structured_outputs:
            # Without native structured outputs, spell the schema out in the instructions.
            system += "\n\nJSON schema:\n" + json.dumps(LABEL_SCHEMA)

        raw = await self._client.complete(
            [{"role": "system", "content": system}, {"role": "user", "content": content}],
            schema=LABEL_SCHEMA if self._structured_outputs else None,
        )
        label = parse_label_analysis(raw)
        result = apply_safeguards(
            label, model=self._model, used_corrected_text=corrected_text is not None
        )
        logger.info(
            "Analysis finished: %s (%s confidence), %d ingredients, %d adjustment(s), %.1fs",
            result.overall_status,
            result.confidence,
            len(result.ingredients),
            len(result.adjustments),
            time.perf_counter() - started,
        )
        return result


def parse_label_analysis(raw: str) -> LabelAnalysis:
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
        return LabelAnalysis.model_validate(data)
    except ValidationError as exc:
        fields = sorted({".".join(str(p) for p in err["loc"]) for err in exc.errors()})
        logger.warning("Model reply failed validation: %s", ", ".join(fields[:10]))
        raise AiInvalidResponseError() from None


def apply_safeguards(
    label: LabelAnalysis, *, model: str, used_corrected_text: bool
) -> IngredientsAnalysis:
    """Enforce rules that must hold whatever the model says.

    The model's overall status can only be made more cautious here, never less, and every change
    is recorded so the user can see it.
    """
    status = label.overall_status
    confidence = label.confidence
    adjustments: list[str] = []

    def downgrade(new_status: str, reason: str) -> None:
        nonlocal status
        if status == new_status:
            return
        adjustments.append(
            f"HalalCheck changed the overall result from “{STATUS_NAMES[status]}” to "
            f"“{STATUS_NAMES[new_status]}” because {reason}."
        )
        status = new_status  # type: ignore[assignment]

    concerns = [i for i in label.ingredients if i.assessment == "potential_concern"]
    unknowns = [
        i for i in label.ingredients if i.assessment == "unknown" or i.needs_more_information
    ]

    if label.prohibited_findings and status != "potentially_non_halal":
        downgrade("potentially_non_halal", "an ingredient from a prohibited source was identified")
    elif not label.label_readable:
        if status == "likely_halal":
            downgrade(
                "needs_further_investigation", "the ingredients list could not be read reliably"
            )
    elif not label.ingredients and not label.extracted_ingredients_text.strip():
        downgrade("needs_further_investigation", "no ingredients could be identified")
    elif status == "likely_halal" and concerns:
        downgrade("potentially_non_halal", "at least one ingredient was marked as a concern")
    elif status == "likely_halal" and unknowns:
        downgrade(
            "needs_further_investigation", "the source of at least one ingredient is uncertain"
        )

    if not label.label_readable and confidence == "high":
        confidence = "low"
        adjustments.append("Confidence was lowered because the label could not be read reliably.")

    return IngredientsAnalysis(
        **label.model_dump(exclude={"overall_status", "confidence"}),
        overall_status=status,
        confidence=confidence,
        model=model,
        used_corrected_text=used_corrected_text,
        adjustments=adjustments,
    )
