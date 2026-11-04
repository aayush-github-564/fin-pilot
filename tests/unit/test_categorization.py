from app.services.categorization import match_category


def test_current_account_does_not_match_rent_rule() -> None:
    assert match_category("CURRENT ACCOUNT TRANSFER") is None


def test_uber_eats_matches_food_before_uber_travel_rule() -> None:
    assert match_category("UBER EATS ORDER") == "Food & Dining"


def test_longer_rent_a_car_rule_wins_over_rent() -> None:
    assert match_category("RENT A CAR") == "Travel"


def test_plain_rent_matches_rent_and_utilities() -> None:
    assert match_category("Monthly rent payment") == "Rent & Utilities"


def test_keyword_must_match_a_word_boundary() -> None:
    assert match_category("internet services") == "Rent & Utilities"
    assert match_category("disinternet") is None
