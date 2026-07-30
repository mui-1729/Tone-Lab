from typing import Literal

from pydantic import BaseModel, Field


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


class ToneDimension(BaseModel):
    key: Literal["brightness", "body", "attack", "compression", "roughness"]
    label: str
    difference: float = Field(ge=-100, le=100)
    interpretation: str
    evidence: list[str]
    suggestion: str


class CompareResponse(BaseModel):
    alignment: AlignmentInfo
    reference: AudioFeatures
    current: AudioFeatures
    dimensions: list[ToneDimension]
    summary: list[str]
    disclaimer: str
