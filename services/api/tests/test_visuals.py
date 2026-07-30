import numpy as np

from app.visuals import SPECTRUM_FLOOR_DB, SPECTRUM_POINTS, WAVEFORM_POINTS, build_visuals


SAMPLE_RATE = 44_100


def guitar_like(seconds: float = 2.0) -> np.ndarray:
    time = np.arange(int(seconds * SAMPLE_RATE)) / SAMPLE_RATE
    envelope = np.minimum(time / 0.02, 1.0) * np.exp(-time / 1.5)
    signal = (
        0.25 * np.sin(2 * np.pi * 220 * time)
        + 0.12 * np.sin(2 * np.pi * 440 * time)
        + 0.03 * np.sin(2 * np.pi * 5_000 * time)
        + 0.015 * np.sin(2 * np.pi * 8_000 * time)
    )
    return (signal * envelope).astype(np.float32)


def boost_treble(signal: np.ndarray, gain_db: float = 6.0) -> np.ndarray:
    spectrum = np.fft.rfft(signal)
    frequencies = np.fft.rfftfreq(signal.size, 1 / SAMPLE_RATE)
    gain = np.ones_like(frequencies)
    target_gain = 10 ** (gain_db / 20)
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


def test_visuals_have_fixed_finite_ranges() -> None:
    signal = guitar_like()
    visuals = build_visuals(signal, signal.copy(), SAMPLE_RATE)

    assert len(visuals.waveform.reference) == WAVEFORM_POINTS
    assert len(visuals.waveform.current) == WAVEFORM_POINTS
    assert len(visuals.spectrum.frequencies_hz) == SPECTRUM_POINTS
    assert len(visuals.spectrum.reference_db) == SPECTRUM_POINTS
    assert len(visuals.spectrum.current_db) == SPECTRUM_POINTS
    assert visuals.waveform.reference == visuals.waveform.current
    assert visuals.spectrum.reference_db == visuals.spectrum.current_db
    assert all(0 <= value <= 1 for value in visuals.waveform.reference)
    assert all(
        SPECTRUM_FLOOR_DB <= value <= 0
        for value in visuals.spectrum.reference_db
    )


def test_treble_boost_is_visible_above_four_kilohertz() -> None:
    signal = guitar_like()
    visuals = build_visuals(signal, boost_treble(signal), SAMPLE_RATE)
    high_indices = [
        index
        for index, frequency in enumerate(visuals.spectrum.frequencies_hz)
        if frequency >= 4_000
        and visuals.spectrum.reference_db[index] > SPECTRUM_FLOOR_DB + 5
    ]
    low_indices = [
        index
        for index, frequency in enumerate(visuals.spectrum.frequencies_hz)
        if frequency <= 500
    ]

    assert high_indices
    high_difference = np.mean(
        [
            visuals.spectrum.current_db[index]
            - visuals.spectrum.reference_db[index]
            for index in high_indices
        ]
    )
    low_difference = np.mean(
        [
            visuals.spectrum.current_db[index]
            - visuals.spectrum.reference_db[index]
            for index in low_indices
        ]
    )

    assert high_difference > 3
    assert abs(low_difference) < 1
