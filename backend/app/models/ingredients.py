from pydantic import BaseModel, Field


class IngredientsExtraction(BaseModel):
    """Text read from a photo of an ingredients label. The text is exactly what OCR produced:
    nothing is corrected or inferred, so users should review it."""

    text: str = Field(description="Extracted text, with line breaks as found on the label.")
    confidence: float | None = Field(
        default=None,
        ge=0,
        le=100,
        description="Average OCR confidence across recognised words (0-100), if available.",
    )
    word_count: int = Field(ge=0)
    uncertain_words: list[str] = Field(
        default_factory=list,
        description="Words the OCR engine was least sure about, worth double-checking.",
    )
    low_confidence: bool = Field(
        description="True when the overall result is unreliable and should be checked closely."
    )
