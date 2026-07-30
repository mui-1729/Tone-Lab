from app.models import ToneDimension
from app.recommendations import build_adjustment_plan


def dimension(key: str, label: str, difference: float) -> ToneDimension:
    return ToneDimension(
        key=key,
        label=label,
        difference=difference,
        interpretation="",
        evidence=[],
        suggestion="",
    )


def test_plan_prioritizes_largest_three_meaningful_differences() -> None:
    plan = build_adjustment_plan(
        [
            dimension("body", "太さ", 12),
            dimension("brightness", "明るさ", 40),
            dimension("attack", "アタック", 7),
            dimension("compression", "圧縮感", -30),
            dimension("roughness", "粗さ", 20),
        ]
    )

    assert [item.key for item in plan] == [
        "brightness",
        "compression",
        "roughness",
    ]
    assert all(abs(item.difference) >= 8 for item in plan)


def test_positive_brightness_recommends_reducing_highs() -> None:
    plan = build_adjustment_plan([dimension("brightness", "明るさ", 35)])

    assert len(plan) == 1
    assert "抑える" in plan[0].title
    assert any("下げる" in action for action in plan[0].actions)


def test_negative_compression_recommends_adding_control() -> None:
    plan = build_adjustment_plan([dimension("compression", "圧縮感", -25)])

    assert len(plan) == 1
    assert "整える" in plan[0].title
    assert any("増やす" in action or "足す" in action for action in plan[0].actions)


def test_near_match_has_no_adjustment_plan() -> None:
    plan = build_adjustment_plan(
        [
            dimension("brightness", "明るさ", 3),
            dimension("body", "太さ", -7.9),
        ]
    )

    assert plan == []
