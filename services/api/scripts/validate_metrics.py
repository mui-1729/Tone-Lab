from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import librosa
import numpy as np
import soundfile as sf

from app.audio import TARGET_SAMPLE_RATE, analyze_signal, build_dimensions

EPSILON = 1e-10


def _rms(signal: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(signal))))


def _match_rms(signal: np.ndarray, reference: np.ndarray) -> np.ndarray:
    matched = signal * (_rms(reference) / max(_rms(signal), EPSILON))
    peak = float(np.max(np.abs(matched)))
    if peak > 0.99:
        matched *= 0.99 / peak
    return matched.astype(np.float32)


def change_volume(signal: np.ndarray, db: float) -> np.ndarray:
    return (signal * (10 ** (db / 20.0))).astype(np.float32)


def boost_treble(signal: np.ndarray, sample_rate: int, gain_db: float = 6.0) -> np.ndarray:
    spectrum = np.fft.rfft(signal)
    frequencies = np.fft.rfftfreq(signal.size, 1.0 / sample_rate)
    target_gain = 10 ** (gain_db / 20.0)
    gain = np.ones_like(frequencies)
    gain[frequencies >= 4_000.0] = target_gain
    transition = (frequencies > 2_000.0) & (frequencies < 4_000.0)
    gain[transition] = 1.0 + (target_gain - 1.0) * (
        frequencies[transition] - 2_000.0
    ) / 2_000.0
    return _match_rms(np.fft.irfft(spectrum * gain, n=signal.size), signal)


def compress_signal(
    signal: np.ndarray,
    sample_rate: int,
    *,
    threshold_offset_db: float,
    ratio: float,
    attack_ms: float,
    release_ms: float,
) -> np.ndarray:
    signal_rms_db = 20.0 * math.log10(max(_rms(signal), EPSILON))
    threshold_db = signal_rms_db + threshold_offset_db
    absolute = np.abs(signal) + EPSILON
    attack = math.exp(-1.0 / (sample_rate * attack_ms / 1_000.0))
    release = math.exp(-1.0 / (sample_rate * release_ms / 1_000.0))
    envelope = np.empty_like(absolute)
    previous = 0.0
    for index, value in enumerate(absolute):
        coefficient = attack if value > previous else release
        previous = coefficient * previous + (1.0 - coefficient) * value
        envelope[index] = previous

    envelope_db = 20.0 * np.log10(np.maximum(envelope, EPSILON))
    over_threshold = np.maximum(envelope_db - threshold_db, 0.0)
    gain_db = -(1.0 - 1.0 / ratio) * over_threshold
    compressed = signal * (10.0 ** (gain_db / 20.0))
    return _match_rms(compressed, signal)


def saturate_signal(signal: np.ndarray, drive: float) -> np.ndarray:
    peak = float(np.max(np.abs(signal)))
    if peak < EPSILON:
        return signal.astype(np.float32)
    normalized = signal / peak
    saturated = np.tanh(drive * normalized) / math.tanh(drive)
    return _match_rms(saturated, signal)


def generate_variants(signal: np.ndarray, sample_rate: int) -> dict[str, np.ndarray]:
    return {
        "volume_minus_6db": change_volume(signal, -6.0),
        "treble_plus_6db": boost_treble(signal, sample_rate, 6.0),
        "compression_light": compress_signal(
            signal,
            sample_rate,
            threshold_offset_db=3.0,
            ratio=2.5,
            attack_ms=15.0,
            release_ms=120.0,
        ),
        "compression_strong": compress_signal(
            signal,
            sample_rate,
            threshold_offset_db=-7.0,
            ratio=8.0,
            attack_ms=5.0,
            release_ms=180.0,
        ),
        "saturation_light": saturate_signal(signal, 2.0),
        "saturation_strong": saturate_signal(signal, 4.0),
    }


def analyze_variants(input_path: Path, output_dir: Path | None = None) -> dict[str, Any]:
    signal, sample_rate = librosa.load(
        input_path,
        sr=TARGET_SAMPLE_RATE,
        mono=True,
        duration=30.0,
    )
    signal = signal.astype(np.float32)
    reference = analyze_signal(signal, sample_rate, input_path.name)
    results: dict[str, Any] = {
        "reference": reference.model_dump(),
        "variants": {},
    }

    if output_dir is not None:
        output_dir.mkdir(parents=True, exist_ok=True)

    for name, variant in generate_variants(signal, sample_rate).items():
        features = analyze_signal(variant, sample_rate, f"{name}.wav")
        dimensions = build_dimensions(reference, features)
        results["variants"][name] = {
            "features": features.model_dump(),
            "dimensions": {item.key: item.difference for item in dimensions},
        }
        if output_dir is not None:
            sf.write(output_dir / f"{name}.wav", variant, sample_rate, subtype="PCM_24")

    return results


def _markdown(results: dict[str, Any]) -> str:
    rows = [
        "| Variant | Brightness | Body | Attack | Compression | Roughness |",
        "|---|---:|---:|---:|---:|---:|",
    ]
    for name, value in results["variants"].items():
        dimensions = value["dimensions"]
        rows.append(
            f"| {name} | {dimensions['brightness']:+.0f} | {dimensions['body']:+.0f} | "
            f"{dimensions['attack']:+.0f} | {dimensions['compression']:+.0f} | "
            f"{dimensions['roughness']:+.0f} |"
        )
    return "\n".join(rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate repeatable Tone Lab metric checks.")
    parser.add_argument("input", type=Path, help="Source WAV/MP3/FLAC/OGG file")
    parser.add_argument("--output-dir", type=Path, help="Write generated WAV variants")
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print full JSON instead of a Markdown table",
    )
    args = parser.parse_args()

    results = analyze_variants(args.input, args.output_dir)
    print(json.dumps(results, ensure_ascii=False, indent=2) if args.json else _markdown(results))


if __name__ == "__main__":
    main()
