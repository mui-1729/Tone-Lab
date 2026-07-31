export type ToneKey = "brightness" | "body" | "attack" | "compression" | "roughness";

export type AudioSelection = {
  start_seconds: number;
  end_seconds: number;
};

export type BandEnergy = {
  low: number;
  low_mid: number;
  mid: number;
  high_mid: number;
  high: number;
};

export type AudioFeatures = {
  filename: string;
  duration_seconds: number;
  sample_rate: number;
  rms_dbfs: number;
  peak_dbfs: number;
  crest_factor_db: number;
  dynamic_range_db: number;
  spectral_centroid_hz: number;
  spectral_bandwidth_hz: number;
  rolloff_85_hz: number;
  spectral_flatness: number;
  zero_crossing_rate: number;
  onset_strength: number;
  band_energy_percent: BandEnergy;
};

export type AlignmentInfo = {
  offset_seconds: number;
  overlap_seconds: number;
  confidence: number;
  warning: string | null;
};

export type SourceQuality = {
  clipped_sample_percent: number;
  warnings: string[];
};

export type QualityInfo = {
  reference: SourceQuality;
  current: SourceQuality;
  comparison_warnings: string[];
};

export type WaveformVisual = {
  duration_seconds: number;
  reference: number[];
  current: number[];
};

export type SpectrumVisual = {
  frequencies_hz: number[];
  reference_db: number[];
  current_db: number[];
};

export type ComparisonVisuals = {
  waveform: WaveformVisual;
  spectrum: SpectrumVisual;
};

export type ToneDimension = {
  key: ToneKey;
  label: string;
  difference: number;
  interpretation: string;
  evidence: string[];
  suggestion: string;
};

export type AdjustmentStep = {
  key: ToneKey;
  label: string;
  difference: number;
  title: string;
  actions: string[];
  verify: string;
};

export type CompareResponse = {
  alignment: AlignmentInfo;
  quality: QualityInfo;
  reference: AudioFeatures;
  current: AudioFeatures;
  visuals: ComparisonVisuals;
  dimensions: ToneDimension[];
  adjustment_plan: AdjustmentStep[];
  summary: string[];
  disclaimer: string;
};
