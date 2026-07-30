from __future__ import annotations

import math
from pathlib import Path

import librosa
import numpy as np

from .models import AudioFeatures, BandEnergy, ToneDimension

TARGET_SAMPLE_RATE = 44_100
MAX_DURATION_SECONDS = 30.0
EPSILON = 1e-10
FLATNESS_BANDS = (
    (80.0, 250.0),
    (250.0, 500.0),
    (500.0, 2_000.0),
    (2_000.0, 5_000.0),
    (5_000.0, 12_000.0),
)


def _finite(value: float) -> float:
    return float(value) if math.isfinite(float(value)) else 0.0


def _db(value: float) -> float:
    return 20.0 * math.log10(max(float(value), EPSILON))


def _median(values: np.ndarray) -> float:
    return _finite(np.median(values)) if values.size else 0.0


def _mean(values: np.ndarray) -> float:
    return _finite(np.mean(values)) if values.size else 0.0


def _band_percent(power: np.ndarray, frequencies: np.ndarray, low: float, high: float) -> float:
    mask = (frequencies >= low) & (frequencies < high)
    total_mask = (frequencies >= 80.0) & (frequencies < 12_000.0)
    total = float(np.sum(power[total_mask])) + EPSILON
    return 100.0 * float(np.sum(power[mask])) / total


def _bandwise_spectral_flatness(magnitude: np.ndarray, frequencies: np.ndarray) -> float:
    """Measure noisiness inside fixed bands without treating spectral tilt as roughness."""
    power = np.square(magnitude) + EPSILON
    band_values: list[float] = []

    for low, high in FLATNESS_BANDS:
        mask = (frequencies >= low) & (frequencies < high)
        band_power = power[mask]
        if band_power.size == 0:
            continue

        geometric_mean = np.exp(np.mean(np.log(band_power), axis=0))
        arithmetic_mean = np.mean(band_power, axis=0)
        frame_flatness = geometric_mean / np.maximum(arithmetic_mean, EPSILON)
        band_values.append(_median(frame_flatness))

    if not band_values:
        return 0.0

    # Give each perceptual band equal influence. A global flatness score changes too
    # strongly when only the overall EQ tilt changes.
    return _finite(np.exp(np.mean(np.log(np.maximum(band_values, EPSILON)))))


def analyze_signal(y: np.ndarray, sample_rate: int, filename: str) -> AudioFeatures:
    if y.ndim != 1:
        y = librosa.to_mono(y)
    if y.size < sample_rate // 2:
        raise ValueError("音源が短すぎます。0.5秒以上の音源を使用してください。")
    if not np.isfinite(y).all():
        raise ValueError("音源に解析できない値が含まれています。")

    trimmed, _ = librosa.effects.trim(y.astype(np.float32), top_db=45)
    if trimmed.size < sample_rate // 2:
        raise ValueError("無音部分を除くと音源が0.5秒未満です。")

    raw_rms = float(np.sqrt(np.mean(np.square(trimmed))))
    raw_peak = float(np.max(np.abs(trimmed)))
    if raw_rms < EPSILON:
        raise ValueError("音量が小さすぎて解析できません。")

    normalized = trimmed * (0.1 / raw_rms)
    normalized = np.clip(normalized, -1.0, 1.0)

    n_fft = 2048
    hop_length = 512
    magnitude = np.abs(librosa.stft(normalized, n_fft=n_fft, hop_length=hop_length))
    power = np.square(magnitude)
    frequencies = librosa.fft_frequencies(sr=sample_rate, n_fft=n_fft)

    frame_rms = librosa.feature.rms(y=trimmed, frame_length=n_fft, hop_length=hop_length)[0]
    frame_db = 20.0 * np.log10(np.maximum(frame_rms, EPSILON))
    dynamic_range = float(np.percentile(frame_db, 95) - np.percentile(frame_db, 10))

    centroid = librosa.feature.spectral_centroid(S=magnitude, sr=sample_rate)[0]
    bandwidth = librosa.feature.spectral_bandwidth(S=magnitude, sr=sample_rate)[0]
    rolloff = librosa.feature.spectral_rolloff(S=magnitude, sr=sample_rate, roll_percent=0.85)[0]
    flatness = _bandwise_spectral_flatness(magnitude, frequencies)
    zcr = librosa.feature.zero_crossing_rate(normalized, frame_length=n_fft, hop_length=hop_length)[0]
    onset = librosa.onset.onset_strength(y=normalized, sr=sample_rate, hop_length=hop_length)

    bands = BandEnergy(
        low=_band_percent(power, frequencies, 80.0, 250.0),
        low_mid=_band_percent(power, frequencies, 250.0, 500.0),
        mid=_band_percent(power, frequencies, 500.0, 2_000.0),
        high_mid=_band_percent(power, frequencies, 2_000.0, 5_000.0),
        high=_band_percent(power, frequencies, 5_000.0, 12_000.0),
    )

    return AudioFeatures(
        filename=filename,
        duration_seconds=round(trimmed.size / sample_rate, 3),
        sample_rate=sample_rate,
        rms_dbfs=round(_db(raw_rms), 3),
        peak_dbfs=round(_db(raw_peak), 3),
        crest_factor_db=round(_db(raw_peak / raw_rms), 3),
        dynamic_range_db=round(_finite(dynamic_range), 3),
        spectral_centroid_hz=round(_median(centroid), 3),
        spectral_bandwidth_hz=round(_median(bandwidth), 3),
        rolloff_85_hz=round(_median(rolloff), 3),
        spectral_flatness=round(flatness, 6),
        zero_crossing_rate=round(_median(zcr), 6),
        onset_strength=round(_mean(onset), 6),
        band_energy_percent=bands,
    )


def analyze_file(path: Path, filename: str) -> AudioFeatures:
    try:
        y, sample_rate = librosa.load(
            path,
            sr=TARGET_SAMPLE_RATE,
            mono=True,
            duration=MAX_DURATION_SECONDS,
        )
    except Exception as exc:  # librosa can raise backend-specific decoding exceptions.
        raise ValueError("音源を読み込めませんでした。WAV、MP3、FLAC、OGGを使用してください。") from exc
    return analyze_signal(y, sample_rate, filename)


def _ratio_delta(reference: float, current: float) -> float:
    value = 100.0 * math.tanh(math.log((current + EPSILON) / (reference + EPSILON)))
    return max(-100.0, min(100.0, value))


def _db_delta(reference: float, current: float, span: float) -> float:
    value = 100.0 * math.tanh((current - reference) / span)
    return max(-100.0, min(100.0, value))


def _state(delta: float, positive: str, negative: str) -> str:
    if abs(delta) < 8:
        return "2つの音はこの項目ではかなり近いです。"
    return positive if delta > 0 else negative


def build_dimensions(reference: AudioFeatures, current: AudioFeatures) -> list[ToneDimension]:
    ref_bands = reference.band_energy_percent
    cur_bands = current.band_energy_percent

    brightness = 0.7 * _ratio_delta(reference.spectral_centroid_hz, current.spectral_centroid_hz)
    brightness += 0.3 * _ratio_delta(ref_bands.high_mid + ref_bands.high, cur_bands.high_mid + cur_bands.high)

    ref_body = ref_bands.low_mid + ref_bands.mid
    cur_body = cur_bands.low_mid + cur_bands.mid
    body = _ratio_delta(ref_body, cur_body)

    attack = _ratio_delta(reference.onset_strength, current.onset_strength)

    # Short-term loudness variation is more stable under EQ than a single raw peak.
    compression = -0.1 * _db_delta(reference.crest_factor_db, current.crest_factor_db, 10.0)
    compression += -0.9 * _db_delta(reference.dynamic_range_db, current.dynamic_range_db, 6.0)

    # Bandwise flatness avoids calling a brighter spectral tilt "rough."
    roughness = 0.85 * _ratio_delta(reference.spectral_flatness, current.spectral_flatness)
    roughness += 0.15 * _ratio_delta(reference.zero_crossing_rate, current.zero_crossing_rate)

    dimensions = [
        ToneDimension(
            key="brightness",
            label="明るさ",
            difference=round(brightness, 2),
            interpretation=_state(brightness, "自分の音のほうが明るく、上側の倍音が目立ちます。", "参考音のほうが明るく、自分の音はやや暗く聞こえる可能性があります。"),
            evidence=[
                f"スペクトル重心: 参考 {reference.spectral_centroid_hz:.0f}Hz / 自分 {current.spectral_centroid_hz:.0f}Hz",
                f"2kHz以上の比率: 参考 {ref_bands.high_mid + ref_bands.high:.1f}% / 自分 {cur_bands.high_mid + cur_bands.high:.1f}%",
            ],
            suggestion="不足している場合はPresenceや2〜4kHz、High Cutを確認します。強すぎる場合は逆方向へ少しずつ調整します。",
        ),
        ToneDimension(
            key="body",
            label="太さ",
            difference=round(body, 2),
            interpretation=_state(body, "自分の音のほうが低中域から中域に密度があります。", "参考音のほうが低中域から中域に密度があり、自分の音は細く感じられる可能性があります。"),
            evidence=[f"250Hz〜2kHzの比率: 参考 {ref_body:.1f}% / 自分 {cur_body:.1f}%"],
            suggestion="不足している場合は180〜500Hzを確認し、増やしすぎる前に低域の不要成分や歪み量も見直します。",
        ),
        ToneDimension(
            key="attack",
            label="アタック",
            difference=round(attack, 2),
            interpretation=_state(attack, "自分の音のほうが音の立ち上がりが強く検出されています。", "参考音のほうが音の立ち上がりが強く、自分の音は丸く聞こえる可能性があります。"),
            evidence=[f"オンセット強度: 参考 {reference.onset_strength:.2f} / 自分 {current.onset_strength:.2f}"],
            suggestion="不足している場合はコンプのAttackを遅くする、Gainを下げる、2〜4kHzを確認する方向が候補です。",
        ),
        ToneDimension(
            key="compression",
            label="圧縮感",
            difference=round(compression, 2),
            interpretation=_state(compression, "自分の音のほうがピークと平均音量の差が小さく、圧縮されている可能性があります。", "参考音のほうが圧縮され、自分の音はダイナミクスが大きい可能性があります。"),
            evidence=[
                f"クレストファクター: 参考 {reference.crest_factor_db:.1f}dB / 自分 {current.crest_factor_db:.1f}dB",
                f"ダイナミックレンジ: 参考 {reference.dynamic_range_db:.1f}dB / 自分 {current.dynamic_range_db:.1f}dB",
            ],
            suggestion="不足している場合はコンプ量や歪み段の飽和を少し増やします。強すぎる場合はRatio、Gain、複数段の重なりを減らします。",
        ),
        ToneDimension(
            key="roughness",
            label="粗さ",
            difference=round(roughness, 2),
            interpretation=_state(roughness, "自分の音のほうがノイズ状・非周期的な成分を多く含む可能性があります。", "参考音のほうが粗く、自分の音は滑らかに聞こえる可能性があります。"),
            evidence=[
                f"帯域内スペクトル平坦度: 参考 {reference.spectral_flatness:.4f} / 自分 {current.spectral_flatness:.4f}",
                f"ゼロ交差率: 参考 {reference.zero_crossing_rate:.4f} / 自分 {current.zero_crossing_rate:.4f}",
            ],
            suggestion="粗すぎる場合はGain、高域、クリッピング段数を減らします。滑らかすぎる場合は歪み量や高域倍音を少し増やします。",
        ),
    ]
    return dimensions


def build_summary(dimensions: list[ToneDimension]) -> list[str]:
    ranked = sorted(dimensions, key=lambda item: abs(item.difference), reverse=True)
    meaningful = [item for item in ranked if abs(item.difference) >= 8][:3]
    if not meaningful:
        return ["5つの質感軸では大きな差が検出されませんでした。"]

    summaries: list[str] = []
    for item in meaningful:
        side = "自分の音が強い" if item.difference > 0 else "参考音が強い"
        summaries.append(f"{item.label}: {side}（差 {abs(item.difference):.0f}）")
    return summaries
