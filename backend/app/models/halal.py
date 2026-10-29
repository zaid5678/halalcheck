from typing import Literal

from pydantic import BaseModel, Field

from app.evidence import PrincipleExplanation
from app.models.product import Product

Ruling = Literal["halal", "haram", "doubtful"]


class Reason(BaseModel):
    ingredient: str = Field(description="The ingredient as written on the label.")
    ruling: Ruling
    note: str
    principle_id: str | None = Field(
        default=None,
        description="Evidence-library principle linked to this knowledge-base ruling, if any.",
    )


class HalalVerdict(BaseModel):
    verdict: Ruling
    reasons: list[Reason] = Field(description="Haram and doubtful ingredients found.")
    ingredients_text: str | None
    ai_checked: bool = Field(description="False when only the ingredient rules were applied.")
    product: Product | None = Field(default=None, description="Null for photo checks.")
    explanations: list[PrincipleExplanation] = Field(
        default_factory=list,
        description="Curated Islamic principles and verified evidence for haram reasons.",
    )
