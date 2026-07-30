from __future__ import annotations

import librosa
import numpy as np

from .models import ComparisonVisuals, SpectrumVisual, WaveformVisual

WAVEFORM_POINTS = 240
SPECTRUM_POINTS = 96
SPECTRUM_MIN_HZ = 80.0
SPECTRUM_MAX_HZ = 12_000.0
SPECTRUM_FLOOR_DB = -60.0
EPSILON = 1e-10


def _rms_envelope(signal: np.ndarray, points: int) -> np.ndarray:
    edges = np.linspace(0, signal.size, points + 1, dtype=int)
    values = np.empty(points, dtype=np.float64)
    for index in range(points):
        segment = signal[edges[index] : edges[index + 1]]
        values[index] = (
            float(np.sqrt(np.mean(np.square(segment)))) if segment.size else 0.0
        )
    return values


def _average_log_spectrum(
    signal: np.ndarray,
    sample_rate: int,
) -> tuple[np.ndarray, np.ndarray]:
    max_frequency = min(SPECTRUM_MAX_HZ, sample_rate / 2.0)
    power = librosa.feature.melspectrogram(
        y=signal.astype(np.float32),
        sr=sample_rate,
        n_fft=2_048,
        hop_length=512,
        n_mels=SPECTRUM_POINTS,
        fmin=SPECTRUM_MIN_HZ,
        fmax=max_frequency,
        power=2.0,
    )
    frequencies = librosa.mel_frequencies(
        n_mels=SPECTRUM_POINTS,
        fmin=SPECTRUM_MIN_HZ,
        fmax=max_frequency,
    )
    return frequencies, np.mean(power, axis=1)


def build_visuals(
    reference: np.ndarray,
    current: np.ndarray,
    sample_rate: int,
) -> ComparisonVisuals:
    reference_envelope = _rms_envelope(reference, WAVEFORM_POINTS)
    current_envelope = _rms_envelope(current, WAVEFORM_POINTS)
    shared_envelope_peak = max(
        float(np.max(reference_envelope)),
        float(np.max(current_envelope)),
        EPSILON,
    )
    reference_envelope /= shared_envelope_peak
    current_envelope /= shared_envelope_peak

    frequencies, reference_power = _average_log_spectrum(reference, sample_rate)
    _, current_power = _average_log_spectrum(current, sample_rate)
    shared_power_peak = max(
        float(np.max(reference_power)),
        float(np.max(current_power)),
        EPSILON,
    )
    reference_db = 10.0 * np.log10(
        np.maximum(reference_power, EPSILON) / shared_power_peak
    )
    current_db = 10.0 * np.log10(
        np.maximum(current_power, EPSILON) / shared_power_peak
    )
    reference_db = np.clip(reference_db, SPECTRUM_FLOOR_DB, 0.0)
    current_db = np.clip(current_db, SPECTRUM_FLOOR_DB, 0.0)

    duration_seconds = min(reference.size, current.size) / sample_rate
    return ComparisonVisuals(
        waveform=WaveformVisual(
            duration_seconds=round(duration_seconds, 3),
            reference=np.round(reference_envelope, 4).tolist(),
            current=np.round(current_envelope, 4).tolist(),
        ),
        spectrum=SpectrumVisual(
            frequencies_hz=np.round(frequencies, 1).tolist(),
            reference_db=np.round(reference_db, 2).tolist(),
            current_db=np.round(current_db, 2).tolist(),
        ),
    )
