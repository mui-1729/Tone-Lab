from __future__ import annotations

import math
from pathlib import Path

import librosa
import numpy as np

from .audio import MAX_DURATION_SECONDS, TARGET_SAMPLE_RATE
from .models import AlignmentInfo

ALIGNMENT_HOP_LENGTH = 512
ALIGNMENT_FRAME_LENGTH = 2_048
MAX_ALIGNMENT_SECONDS = 5.0
MATCH_WARNING_THRESHOLD = 0.35
ALIGNMENT_SCORE_TOLERANCE = 0.03
EPSILON = 1e-10


def _standardize(values: np.ndarray) -> np.ndarray:
    values = np.asarray(values, dtype=np.float64)
    scale = float(np.std(values))
    if values.size == 0 or scale < EPSILON:
        return np.zeros_like(values)
    return (values - np.median(values)) / scale


def _alignment_features(signal: np.ndarray, sample_rate: int) -> tuple[np.ndarray, np.ndarray]:
    onset = librosa.onset.onset_strength(
        y=signal,
        sr=sample_rate,
        hop_length=ALIGNMENT_HOP_LENGTH,
    )
    frame_rms = librosa.feature.rms(
        y=signal,
        frame_length=ALIGNMENT_FRAME_LENGTH,
        hop_length=ALIGNMENT_HOP_LENGTH,
    )[0]
    rms_db = 20.0 * np.log10(np.maximum(frame_rms, EPSILON))
    return _standardize(onset), _standardize(rms_db)


def _lagged_segments(
    reference: np.ndarray,
    current: np.ndarray,
    lag_frames: int,
) -> tuple[np.ndarray, np.ndarray]:
    if lag_frames >= 0:
        length = min(reference.size, current.size - lag_frames)
        if length <= 0:
            return reference[:0], current[:0]
        return reference[:length], current[lag_frames : lag_frames + length]

    reference_start = -lag_frames
    length = min(reference.size - reference_start, current.size)
    if length <= 0:
        return reference[:0], current[:0]
    return reference[reference_start : reference_start + length], current[:length]


def _cosine_similarity(reference: np.ndarray, current: np.ndarray) -> float | None:
    denominator = float(np.linalg.norm(reference) * np.linalg.norm(current))
    if denominator < EPSILON:
        return None
    return float(np.dot(reference, current) / denominator)


def _score_lag(
    reference_onset: np.ndarray,
    current_onset: np.ndarray,
    reference_rms: np.ndarray,
    current_rms: np.ndarray,
    lag_frames: int,
    minimum_overlap_frames: int,
) -> float | None:
    weighted_scores: list[tuple[float, float]] = []

    for weight, reference_feature, current_feature in (
        (0.7, reference_onset, current_onset),
        (0.3, reference_rms, current_rms),
    ):
        reference_segment, current_segment = _lagged_segments(
            reference_feature,
            current_feature,
            lag_frames,
        )
        if reference_segment.size < minimum_overlap_frames:
            continue

        similarity = _cosine_similarity(reference_segment, current_segment)
        if similarity is not None:
            weighted_scores.append((weight, similarity))

    if not weighted_scores:
        return None

    total_weight = sum(weight for weight, _ in weighted_scores)
    return sum(weight * score for weight, score in weighted_scores) / total_weight


def load_audio(path: Path) -> tuple[np.ndarray, int]:
    try:
        signal, sample_rate = librosa.load(
            path,
            sr=TARGET_SAMPLE_RATE,
            mono=True,
            duration=MAX_DURATION_SECONDS,
        )
    except Exception as exc:
        raise ValueError(
            "音源を読み込めませんでした。WAV、MP3、FLAC、OGGを使用してください。"
        ) from exc

    signal = signal.astype(np.float32)
    if not np.isfinite(signal).all():
        raise ValueError("音源に解析できない値が含まれています。")
    return signal, sample_rate


def align_signals(
    reference: np.ndarray,
    current: np.ndarray,
    sample_rate: int,
    max_shift_seconds: float = MAX_ALIGNMENT_SECONDS,
) -> tuple[np.ndarray, np.ndarray, AlignmentInfo]:
    reference_onset, reference_rms = _alignment_features(reference, sample_rate)
    current_onset, current_rms = _alignment_features(current, sample_rate)

    shorter_frames = min(reference_onset.size, current_onset.size)
    if shorter_frames == 0:
        raise ValueError("音源が短すぎて位置合わせできません。")

    one_second_frames = max(1, int(round(sample_rate / ALIGNMENT_HOP_LENGTH)))
    minimum_overlap_frames = min(
        shorter_frames,
        max(4, one_second_frames, int(shorter_frames * 0.5)),
    )
    search_limit_frames = max(
        0,
        int(round(max_shift_seconds * sample_rate / ALIGNMENT_HOP_LENGTH)),
    )
    available_lag_frames = max(
        0,
        max(reference_onset.size, current_onset.size) - minimum_overlap_frames,
    )
    max_lag_frames = min(search_limit_frames, available_lag_frames)

    candidates: list[tuple[float, int]] = []
    for lag_frames in range(-max_lag_frames, max_lag_frames + 1):
        score = _score_lag(
            reference_onset,
            current_onset,
            reference_rms,
            current_rms,
            lag_frames,
            minimum_overlap_frames,
        )
        if score is not None:
            candidates.append((score, lag_frames))

    if candidates:
        highest_score = max(score for score, _ in candidates)
        near_best = [
            (score, lag_frames)
            for score, lag_frames in candidates
            if score >= highest_score - ALIGNMENT_SCORE_TOLERANCE
        ]
        best_score, best_lag_frames = min(
            near_best,
            key=lambda item: (abs(item[1]), -item[0]),
        )
    else:
        best_score = 0.0
        best_lag_frames = 0

    confidence = max(0.0, min(1.0, float(best_score)))
    detected_lag_frames = best_lag_frames
    if confidence < MATCH_WARNING_THRESHOLD:
        best_lag_frames = 0

    offset_samples = best_lag_frames * ALIGNMENT_HOP_LENGTH
    if offset_samples >= 0:
        reference_start = 0
        current_start = offset_samples
    else:
        reference_start = -offset_samples
        current_start = 0

    overlap_samples = min(
        reference.size - reference_start,
        current.size - current_start,
    )
    if overlap_samples < sample_rate // 2:
        raise ValueError("位置合わせ後の比較区間が0.5秒未満です。")

    aligned_reference = reference[
        reference_start : reference_start + overlap_samples
    ].astype(np.float32, copy=False)
    aligned_current = current[
        current_start : current_start + overlap_samples
    ].astype(np.float32, copy=False)

    warnings: list[str] = []
    if confidence < MATCH_WARNING_THRESHOLD:
        warnings.append(
            "フレーズの一致度が低いため位置合わせを適用していません。"
            "同じフレーズを演奏しているか確認してください。"
        )
    if search_limit_frames > 0 and abs(detected_lag_frames) >= search_limit_frames:
        warnings.append(
            f"開始位置のずれが探索上限の{max_shift_seconds:.0f}秒に達しました。"
        )
    overlap_seconds = overlap_samples / sample_rate
    if overlap_seconds < 2.0:
        warnings.append("位置合わせ後の比較区間が短いため、結果が不安定な可能性があります。")

    alignment = AlignmentInfo(
        offset_seconds=round(offset_samples / sample_rate, 3),
        overlap_seconds=round(overlap_seconds, 3),
        confidence=round(confidence, 3),
        warning=" ".join(warnings) or None,
    )
    return aligned_reference, aligned_current, alignment


def load_and_align_files(
    reference_path: Path,
    current_path: Path,
) -> tuple[np.ndarray, np.ndarray, int, AlignmentInfo]:
    reference, reference_sample_rate = load_audio(reference_path)
    current, current_sample_rate = load_audio(current_path)
    if reference_sample_rate != current_sample_rate:
        raise ValueError("2つの音源のサンプルレートを統一できませんでした。")

    aligned_reference, aligned_current, alignment = align_signals(
        reference,
        current,
        reference_sample_rate,
    )
    return (
        aligned_reference,
        aligned_current,
        reference_sample_rate,
        alignment,
    )
