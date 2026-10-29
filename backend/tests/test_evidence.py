"""Integrity of the curated Islamic evidence library."""

import re

from app.evidence import PROHIBITED_SOURCES, get_library


def test_library_loads_and_references_resolve() -> None:
    library = get_library()  # Validation fails on any dangling reference.
    assert len(library.evidence) >= 10
    assert {p.id for p in library.principles} >= set(PROHIBITED_SOURCES)


def test_requested_quran_verses_are_present() -> None:
    references = {item.reference for item in get_library().evidence}
    assert {"Qur'an 2:173", "Qur'an 5:3", "Qur'an 6:145"} <= references


def test_every_item_is_complete_and_linkable() -> None:
    for item in get_library().evidence:
        assert item.arabic_text and item.translation and item.translation_source
        if item.source_type == "quran":
            surah, verse = re.fullmatch(r"Qur'an (\d+):(\d+)", item.reference).groups()  # type: ignore[union-attr]
            assert item.url == f"https://quran.com/{surah}/{verse}"
            assert item.id == f"quran-{surah}-{verse}"
        else:
            assert item.authenticity is not None
            assert item.authenticity.grade and item.authenticity.graded_by
            assert item.url.startswith("https://sunnah.com/")
            assert item.narrator


def test_arabic_text_is_arabic() -> None:
    for item in get_library().evidence:
        assert re.search(r"[؀-ۿ]", item.arabic_text), item.id


def test_disputed_and_caution_principles_cannot_produce_haram() -> None:
    library = get_library()
    for principle in library.principles:
        if principle.category != "prohibited":
            assert principle.id not in PROHIBITED_SOURCES
    # Slaughter can't be established from a label's source alone.
    assert PROHIBITED_SOURCES["carrion"] == frozenset()


def test_hadith_notes_do_not_overstate() -> None:
    swine = get_library().principle("swine")
    assert swine is not None
    assert "does not mention modern food additives" in swine.evidence_notes["hadith-bukhari-2236"]
