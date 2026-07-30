from __future__ import annotations

import numpy as np

from .models import AudioFeatures, QualityInfo, SourceQuality

CLIPPING_THRESHOLD = 0.999
CLIPPED_PERCENT_WARNING = 0.01
NEAR_CEILING_DBFS = -0.1
LOW_LEVEL_DBFS = -55.0
LEVEL_MISMATCH_DB = 6.0


def _source_quality(signal: np.ndarray, features: AudioFeatures) -> SourceQuality:
    clipped_percent = 100.0 * float(
        np.mean(np.abs(signal.astype(np.float64)) >= CLIPPING_THRESHOLD)
    )
    warnings: list[str] = []

    if clipped_percent >= CLIPPED_PERCENT_WARNING:
        warnings.append(
            f"クリッピング候補が{clipped_percent:.3f}%あります。録音レベルまたは書き出し設定を下げてください。"
        )
    elif features.peak_dbfs >= NEAR_CEILING_DBFS:
        warnings.append(
            "ピークが0dBFS付近です。後段処理の余裕を確保するため、少しレベルを下げてください。"
        )

    if features.rms_dbfs < LOW_LEVEL_DBFS:
        warnings.append(
            "平均音量がかなり小さいため、ノイズの影響を受けやすい可能性があります。"
        )

    return SourceQuality(
        clipped_sample_percent=round(clipped_percent, 4),
        warnings=warnings,
    )


def build_quality_info(
    reference_signal: np.ndarray,
    current_signal: np.ndarray,
    reference_features: AudioFeatures,
    current_features: AudioFeatures,
) -> QualityInfo:
    comparison_warnings: list[str] = []
    level_difference = abs(reference_features.rms_dbfs - current_features.rms_dbfs)
    if level_difference > LEVEL_MISMATCH_DB:
        comparison_warnings.append(
            f"2音源の平均音量差が{level_difference:.1f}dBあります。質感解析は音量を揃えて行いますが、試聴時の印象には影響します。"
        )

    return QualityInfo(
        reference=_source_quality(reference_signal, reference_features),
        current=_source_quality(current_signal, current_features),
        comparison_warnings=comparison_warnings,
    )
