from typing import Literal

from pydantic import BaseModel, Field


ToneKey = Literal["brightness", "body", "attack", "compression", "roughness"]


class BandEnergy(BaseModel):
    low: float
    low_mid: float
    mid: float
    high_mid: float
    high: float


class AudioFeatures(BaseModel):
    filename: str
    duration_seconds: float
    sample_rate: int
    rms_dbfs: float
    peak_dbfs: float
    crest_factor_db: float
    dynamic_range_db: float
    spectral_centroid_hz: float
    spectral_bandwidth_hz: float
    rolloff_85_hz: float
    spectral_flatness: float
    zero_crossing_rate: float
    onset_strength: float
    band_energy_percent: BandEnergy


class AlignmentInfo(BaseModel):
    offset_seconds: float
    overlap_seconds: float
    confidence: float = Field(ge=0, le=1)
    warning: str | None = None


class SourceQuality(BaseModel):
    clipped_sample_percent: float = Field(ge=0, le=100)
    warnings: list[str]


class QualityInfo(BaseModel):
    reference: SourceQuality
    current: SourceQuality
    comparison_warnings: list[str]


class WaveformVisual(BaseModel):
    duration_seconds: float
    reference: list[float]
    current: list[float]


class SpectrumVisual(BaseModel):
    frequencies_hz: list[float]
    reference_db: list[float]
    current_db: list[float]


class ComparisonVisuals(BaseModel):
    waveform: WaveformVisual
    spectrum: SpectrumVisual


class ToneDimension(BaseModel):
    key: ToneKey
    label: str
    difference: float = Field(ge=-100, le=100)
    interpretation: str
    evidence: list[str]
    suggestion: str


class AdjustmentStep(BaseModel):
    key: ToneKey
    label: str
    difference: float = Field(ge=-100, le=100)
    title: str
    actions: list[str]
    verify: str


class CompareResponse(BaseModel):
    alignment: AlignmentInfo
    quality: QualityInfo
    reference: AudioFeatures
    current: AudioFeatures
    visuals: ComparisonVisuals
    dimensions: list[ToneDimension]
    adjustment_plan: list[AdjustmentStep]
    summary: list[str]
    disclaimer: str
