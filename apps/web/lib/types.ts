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

export type ToneDimension = {
  key: "brightness" | "body" | "attack" | "compression" | "roughness";
  label: string;
  difference: number;
  interpretation: string;
  evidence: string[];
  suggestion: string;
};

export type CompareResponse = {
  alignment: AlignmentInfo;
  reference: AudioFeatures;
  current: AudioFeatures;
  dimensions: ToneDimension[];
  summary: string[];
  disclaimer: string;
};
