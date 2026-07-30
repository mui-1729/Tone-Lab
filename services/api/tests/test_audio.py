import numpy as np

from app.audio import analyze_signal, build_dimensions


def sine(frequency: float, seconds: float = 2.0, sample_rate: int = 44_100) -> np.ndarray:
    time = np.arange(int(seconds * sample_rate)) / sample_rate
    envelope = np.minimum(time / 0.02, 1.0) * np.exp(-time / 1.8)
    return (0.3 * envelope * np.sin(2 * np.pi * frequency * time)).astype(np.float32)


def test_higher_frequency_is_brighter() -> None:
    reference = analyze_signal(sine(220), 44_100, "low.wav")
    current = analyze_signal(sine(1_760), 44_100, "high.wav")
    dimensions = {item.key: item for item in build_dimensions(reference, current)}

    assert current.spectral_centroid_hz > reference.spectral_centroid_hz
    assert dimensions["brightness"].difference > 0


def test_identical_audio_has_small_differences() -> None:
    signal = sine(440)
    reference = analyze_signal(signal, 44_100, "a.wav")
    current = analyze_signal(signal.copy(), 44_100, "b.wav")

    for dimension in build_dimensions(reference, current):
        assert abs(dimension.difference) < 1
