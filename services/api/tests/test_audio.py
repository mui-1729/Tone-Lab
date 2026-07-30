import numpy as np

from app.audio import analyze_signal, build_dimensions


def sine(frequency: float, seconds: float = 2.0, sample_rate: int = 44_100) -> np.ndarray:
    time = np.arange(int(seconds * sample_rate)) / sample_rate
    envelope = np.minimum(time / 0.02, 1.0) * np.exp(-time / 1.8)
    return (0.3 * envelope * np.sin(2 * np.pi * frequency * time)).astype(np.float32)


def guitar_like(seconds: float = 2.0, sample_rate: int = 44_100) -> np.ndarray:
    time = np.arange(int(seconds * sample_rate)) / sample_rate
    envelope = np.minimum(time / 0.02, 1.0) * np.exp(-time / 1.8)
    signal = np.zeros_like(time)

    for harmonic, amplitude in ((1, 0.22), (2, 0.12), (3, 0.08), (5, 0.05), (8, 0.03), (16, 0.015)):
        signal += amplitude * envelope * np.sin(2 * np.pi * 220 * harmonic * time)

    return signal.astype(np.float32)


def boost_highs(signal: np.ndarray, sample_rate: int = 44_100) -> np.ndarray:
    spectrum = np.fft.rfft(signal)
    frequencies = np.fft.rfftfreq(signal.size, 1 / sample_rate)
    target_gain = 10 ** (6 / 20)
    gain = np.ones_like(frequencies)

    gain[frequencies >= 4_000] = target_gain
    transition = (frequencies > 2_000) & (frequencies < 4_000)
    gain[transition] = 1 + (target_gain - 1) * (frequencies[transition] - 2_000) / 2_000

    return np.fft.irfft(spectrum * gain, n=signal.size).astype(np.float32)


def alternating_levels(seconds: float = 4.0, sample_rate: int = 44_100) -> np.ndarray:
    time = np.arange(int(seconds * sample_rate)) / sample_rate
    carrier = np.sin(2 * np.pi * 220 * time) + 0.35 * np.sin(2 * np.pi * 440 * time)
    levels = np.where(((time / 0.5).astype(int) % 2) == 0, 0.08, 0.4)
    phase = time % 0.5
    fade = np.minimum(phase / 0.01, 1.0) * np.minimum((0.5 - phase) / 0.01, 1.0)
    return (carrier * levels * fade).astype(np.float32)


def compress_samples(signal: np.ndarray, threshold: float = 0.1, ratio: float = 4.0) -> np.ndarray:
    amplitude = np.abs(signal)
    compressed_amplitude = amplitude.copy()
    above_threshold = amplitude > threshold
    compressed_amplitude[above_threshold] = threshold + (
        amplitude[above_threshold] - threshold
    ) / ratio

    compressed = np.sign(signal) * compressed_amplitude
    original_rms = np.sqrt(np.mean(np.square(signal)))
    compressed_rms = np.sqrt(np.mean(np.square(compressed)))
    return (compressed * original_rms / compressed_rms).astype(np.float32)


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


def test_volume_change_does_not_change_tone_dimensions() -> None:
    signal = guitar_like()
    reference = analyze_signal(signal, 44_100, "reference.wav")
    quieter = analyze_signal(signal * 0.25, 44_100, "quieter.wav")

    for dimension in build_dimensions(reference, quieter):
        assert abs(dimension.difference) < 1


def test_treble_boost_does_not_look_highly_compressed_or_rough() -> None:
    signal = guitar_like()
    reference = analyze_signal(signal, 44_100, "reference.wav")
    current = analyze_signal(boost_highs(signal), 44_100, "treble.wav")
    dimensions = {item.key: item for item in build_dimensions(reference, current)}

    assert dimensions["brightness"].difference > 8
    assert abs(dimensions["compression"].difference) < 10
    assert abs(dimensions["roughness"].difference) < 10


def test_reduced_level_variation_increases_compression() -> None:
    signal = alternating_levels()
    reference = analyze_signal(signal, 44_100, "reference.wav")
    current = analyze_signal(compress_samples(signal), 44_100, "compressed.wav")
    dimensions = {item.key: item for item in build_dimensions(reference, current)}

    assert current.dynamic_range_db < reference.dynamic_range_db
    assert dimensions["compression"].difference > 20
