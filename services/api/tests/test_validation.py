import numpy as np

from app.audio import analyze_signal, build_dimensions
from scripts.validate_metrics import (
    boost_body,
    compress_signal,
    enhance_transients,
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


def repeated_guitar(seconds: float = 4.0, sample_rate: int = 44_100) -> np.ndarray:
    note_seconds = 0.5
    notes = []
    for index in range(int(seconds / note_seconds)):
        time = np.arange(int(note_seconds * sample_rate)) / sample_rate
        envelope = np.minimum(time / 0.015, 1.0) * np.exp(
            -time / (0.22 + 0.02 * (index % 3))
        )
        note = np.zeros_like(time)
        fundamental = 196.0 + 12.0 * (index % 4)
        for harmonic, amplitude in (
            (1, 0.22),
            (2, 0.12),
            (3, 0.08),
            (5, 0.05),
            (8, 0.03),
            (16, 0.015),
        ):
            note += amplitude * envelope * np.sin(
                2 * np.pi * fundamental * harmonic * time
            )
        notes.append(note)
    return np.concatenate(notes).astype(np.float32)


def compare(reference_signal: np.ndarray, current_signal: np.ndarray) -> dict[str, float]:
    reference = analyze_signal(reference_signal, 44_100, "reference.wav")
    current = analyze_signal(current_signal, 44_100, "current.wav")
    return {item.key: item.difference for item in build_dimensions(reference, current)}


def test_stronger_body_boost_increases_body_dimension() -> None:
    signal = repeated_guitar()
    light_dimensions = compare(signal, boost_body(signal, 44_100, 1.5))
    strong_dimensions = compare(signal, boost_body(signal, 44_100, 3.0))

    assert light_dimensions["body"] > 8
    assert strong_dimensions["body"] > light_dimensions["body"] + 10
    assert strong_dimensions["body"] > abs(strong_dimensions["brightness"])
    assert strong_dimensions["body"] > abs(strong_dimensions["compression"])


def test_stronger_transient_enhancement_increases_attack_dimension() -> None:
    signal = repeated_guitar()
    light_dimensions = compare(signal, enhance_transients(signal, 44_100, 3.0))
    strong_dimensions = compare(signal, enhance_transients(signal, 44_100, 6.0))

    assert light_dimensions["attack"] > 8
    assert strong_dimensions["attack"] > light_dimensions["attack"] + 8
    for key in ("brightness", "body", "compression", "roughness"):
        assert abs(strong_dimensions[key]) < 8


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
