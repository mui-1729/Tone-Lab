import numpy as np

from app.audio import analyze_signal, build_dimensions
from scripts.validate_metrics import (
    compress_signal,
    generate_variants,
    saturate_signal,
)


def guitar_like(seconds: float = 2.0, sample_rate: int = 44_100) -> np.ndarray:
    time = np.arange(int(seconds * sample_rate)) / sample_rate
    envelope = np.minimum(time / 0.02, 1.0) * np.exp(-time / 1.8)
    signal = np.zeros_like(time)

    harmonics = ((1, 0.22), (2, 0.12), (3, 0.08), (5, 0.05), (8, 0.03), (16, 0.015))
    for harmonic, amplitude in harmonics:
        signal += amplitude * envelope * np.sin(2 * np.pi * 220 * harmonic * time)

    return signal.astype(np.float32)


def compare(reference_signal: np.ndarray, current_signal: np.ndarray) -> dict[str, float]:
    reference = analyze_signal(reference_signal, 44_100, "reference.wav")
    current = analyze_signal(current_signal, 44_100, "current.wav")
    return {item.key: item.difference for item in build_dimensions(reference, current)}


def test_stronger_compression_increases_compression_dimension() -> None:
    signal = guitar_like()
    light = compress_signal(
        signal,
        44_100,
        threshold_offset_db=3.0,
        ratio=2.5,
        attack_ms=15.0,
        release_ms=120.0,
    )
    strong = compress_signal(
        signal,
        44_100,
        threshold_offset_db=-7.0,
        ratio=8.0,
        attack_ms=5.0,
        release_ms=180.0,
    )

    light_dimensions = compare(signal, light)
    strong_dimensions = compare(signal, strong)

    assert light_dimensions["compression"] > 8
    assert strong_dimensions["compression"] > light_dimensions["compression"] + 20


def test_stronger_saturation_increases_roughness_dimension() -> None:
    signal = guitar_like()
    light_dimensions = compare(signal, saturate_signal(signal, 2.0))
    strong_dimensions = compare(signal, saturate_signal(signal, 4.0))

    assert light_dimensions["roughness"] > 20
    assert strong_dimensions["roughness"] > light_dimensions["roughness"] + 15
    assert strong_dimensions["compression"] > light_dimensions["compression"]


def test_generated_variants_keep_safe_peak_headroom() -> None:
    signal = guitar_like()
    signal *= 0.99 / np.max(np.abs(signal))

    for variant in generate_variants(signal, 44_100).values():
        assert np.max(np.abs(variant)) <= 0.990001
