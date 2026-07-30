import numpy as np

from app.audio import analyze_signal
from app.quality import build_quality_info


SAMPLE_RATE = 44_100


def sine(amplitude: float = 0.2, seconds: float = 1.0) -> np.ndarray:
    time = np.arange(int(seconds * SAMPLE_RATE)) / SAMPLE_RATE
    return (amplitude * np.sin(2 * np.pi * 440 * time)).astype(np.float32)


def quality(reference: np.ndarray, current: np.ndarray):
    reference_features = analyze_signal(reference, SAMPLE_RATE, "reference.wav")
    current_features = analyze_signal(current, SAMPLE_RATE, "current.wav")
    return build_quality_info(
        reference,
        current,
        reference_features,
        current_features,
    )


def test_clean_inputs_have_no_warnings() -> None:
    result = quality(sine(0.2), sine(0.18))

    assert result.reference.warnings == []
    assert result.current.warnings == []
    assert result.comparison_warnings == []


def test_clipped_samples_are_reported() -> None:
    signal = sine(1.2)
    signal = np.clip(signal, -1.0, 1.0).astype(np.float32)
    result = quality(signal, sine())

    assert result.reference.clipped_sample_percent > 0.01
    assert any("クリッピング" in warning for warning in result.reference.warnings)


def test_low_level_is_reported() -> None:
    result = quality(sine(0.2), sine(0.0005))

    assert any("平均音量" in warning for warning in result.current.warnings)


def test_large_level_mismatch_is_reported() -> None:
    result = quality(sine(0.4), sine(0.1))

    assert any("平均音量差" in warning for warning in result.comparison_warnings)
