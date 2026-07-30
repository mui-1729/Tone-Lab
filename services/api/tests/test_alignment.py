import numpy as np

from app.alignment import ALIGNMENT_HOP_LENGTH, MATCH_WARNING_THRESHOLD, align_signals
from app.audio import analyze_signal, build_dimensions


SAMPLE_RATE = 44_100


def repeated_guitar(seconds: float = 4.0) -> np.ndarray:
    note_seconds = 0.5
    notes = []
    for index in range(int(seconds / note_seconds)):
        time = np.arange(int(note_seconds * SAMPLE_RATE)) / SAMPLE_RATE
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


def boost_highs(signal: np.ndarray) -> np.ndarray:
    spectrum = np.fft.rfft(signal)
    frequencies = np.fft.rfftfreq(signal.size, 1 / SAMPLE_RATE)
    target_gain = 10 ** (6 / 20)
    gain = np.ones_like(frequencies)
    gain[frequencies >= 4_000] = target_gain
    transition = (frequencies > 2_000) & (frequencies < 4_000)
    gain[transition] = 1 + (target_gain - 1) * (
        frequencies[transition] - 2_000
    ) / 2_000
    boosted = np.fft.irfft(spectrum * gain, n=signal.size)
    boosted *= np.sqrt(np.mean(np.square(signal))) / np.sqrt(
        np.mean(np.square(boosted))
    )
    return boosted.astype(np.float32)


def dimensions(reference: np.ndarray, current: np.ndarray) -> dict[str, float]:
    reference_features = analyze_signal(reference, SAMPLE_RATE, "reference.wav")
    current_features = analyze_signal(current, SAMPLE_RATE, "current.wav")
    return {
        item.key: item.difference
        for item in build_dimensions(reference_features, current_features)
    }


def test_positive_offset_is_detected_and_removed() -> None:
    reference = repeated_guitar()
    shift_frames = 65
    shift_samples = shift_frames * ALIGNMENT_HOP_LENGTH
    current = np.pad(reference, (shift_samples, 0))

    aligned_reference, aligned_current, alignment = align_signals(
        reference,
        current,
        SAMPLE_RATE,
    )

    assert abs(
        alignment.offset_seconds - shift_samples / SAMPLE_RATE
    ) < ALIGNMENT_HOP_LENGTH / SAMPLE_RATE
    assert alignment.confidence > 0.85
    assert alignment.warning is None
    assert np.array_equal(aligned_reference, aligned_current)
    for difference in dimensions(aligned_reference, aligned_current).values():
        assert abs(difference) < 1


def test_negative_offset_is_detected() -> None:
    current = repeated_guitar()
    shift_frames = 43
    shift_samples = shift_frames * ALIGNMENT_HOP_LENGTH
    reference = np.pad(current, (shift_samples, 0))

    _, _, alignment = align_signals(reference, current, SAMPLE_RATE)

    assert abs(
        alignment.offset_seconds + shift_samples / SAMPLE_RATE
    ) < ALIGNMENT_HOP_LENGTH / SAMPLE_RATE
    assert alignment.confidence > 0.9


def test_shifted_treble_boost_keeps_brightness_as_main_change() -> None:
    reference = repeated_guitar()
    shifted_current = np.pad(
        boost_highs(reference),
        (48 * ALIGNMENT_HOP_LENGTH, 0),
    )

    aligned_reference, aligned_current, alignment = align_signals(
        reference,
        shifted_current,
        SAMPLE_RATE,
    )
    result = dimensions(aligned_reference, aligned_current)

    assert alignment.confidence > 0.8
    assert result["brightness"] > 8
    assert abs(result["compression"]) < 10
    assert abs(result["roughness"]) < 10


def test_unrelated_audio_returns_low_match_warning() -> None:
    reference = repeated_guitar()
    random = np.random.default_rng(42)
    current = random.normal(0, 0.03, size=reference.size).astype(np.float32)

    _, _, alignment = align_signals(reference, current, SAMPLE_RATE)

    assert alignment.confidence < MATCH_WARNING_THRESHOLD
    assert alignment.warning is not None
    assert "同じフレーズ" in alignment.warning
