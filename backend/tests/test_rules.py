import pytest

from app.services.rules import check_ingredients, overall_verdict


def rulings_for(text: str) -> dict[str, str]:
    return {reason.ingredient.lower(): reason.ruling for reason in check_ingredients(text)}


def test_pork_is_haram() -> None:
    assert rulings_for("Pork (90%), Salt, Water") == {"pork": "haram"}


@pytest.mark.parametrize("text", ["colour: E120", "colour (e 120)", "Colour: e-120", "carmine"])
def test_e_numbers_match_any_spelling(text: str) -> None:
    assert list(rulings_for(text).values()) == ["haram"]


def test_unknown_gelatine_is_doubtful() -> None:
    assert rulings_for("Sugar, Gelatine, Citric Acid") == {"gelatine": "doubtful"}


def test_longest_match_wins() -> None:
    assert rulings_for("Sugar, Halal Beef Gelatine") == {}
    assert rulings_for("Pork Gelatine") == {"pork gelatine": "haram"}


def test_vinegar_is_not_alcohol() -> None:
    assert rulings_for("Spirit Vinegar, White Wine Vinegar, Salt") == {}


def test_matches_whole_words_only() -> None:
    assert rulings_for("Graham flour, Shampoo, Hamper") == {}


def test_each_ingredient_reported_once() -> None:
    assert len(check_ingredients("Gelatine, sugar, gelatine")) == 1


def test_overall_verdict() -> None:
    assert overall_verdict(check_ingredients("pork, gelatine")) == "haram"
    assert overall_verdict(check_ingredients("sugar, gelatine")) == "doubtful"
    assert overall_verdict(check_ingredients("sugar, salt")) == "halal"
