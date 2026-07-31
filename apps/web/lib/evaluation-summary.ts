import type { QualityInfo, ToneKey } from "@/lib/types";

export type EvaluationRating = "agree" | "disagree" | "unsure" | "unrated";
export type OverallRating = "agree" | "partial" | "disagree" | "";

export type EvaluationDimension = {
  key: ToneKey;
  label: string;
  predicted_difference: number;
  rating: EvaluationRating;
};

export type EvaluationRecord = {
  id: string;
  source_name: string;
  schema_version: number;
  evaluated_at: string;
  files: { reference: string; current: string };
  overall: OverallRating;
  notes: string;
  alignment: { confidence: number; warning?: string | null };
  quality: QualityInfo | null;
  dimensions: EvaluationDimension[];
};

export type AxisEvaluationSummary = {
  key: ToneKey;
  label: string;
  agree: number;
  disagree: number;
  unsure: number;
  unrated: number;
  agreement_rate: number | null;
};

export type DifferenceBucketSummary = {
  key: "under_8" | "8_19" | "20_39" | "40_plus";
  label: string;
  agree: number;
  disagree: number;
  unsure: number;
  agreement_rate: number | null;
};

export type EvaluationProblem = {
  record_id: string;
  source_name: string;
  files: EvaluationRecord["files"];
  reasons: string[];
};

export type EvaluationSummary = {
  record_count: number;
  target_count: number;
  overall: Record<"agree" | "partial" | "disagree" | "unrated", number>;
  axes: AxisEvaluationSummary[];
  buckets: DifferenceBucketSummary[];
  quality_known_count: number;
  warning_record_count: number;
  low_alignment_count: number;
  problems: EvaluationProblem[];
};

const TONE_LABELS: Record<ToneKey, string> = {
  brightness: "明るさ",
  body: "太さ",
  attack: "アタック",
  compression: "圧縮感",
  roughness: "粗さ",
};

const RATINGS = new Set<EvaluationRating>(["agree", "disagree", "unsure", "unrated"]);
const OVERALL = new Set<OverallRating>(["agree", "partial", "disagree", ""]);
const TONE_KEYS = new Set<ToneKey>(Object.keys(TONE_LABELS) as ToneKey[]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseFiles(value: unknown) {
  if (!isObject(value)) return null;
  const reference = stringValue(value.reference);
  const current = stringValue(value.current);
  return reference && current ? { reference, current } : null;
}

function parseQuality(value: unknown): QualityInfo | null {
  if (!isObject(value) || !isObject(value.reference) || !isObject(value.current)) return null;
  const referenceWarnings = Array.isArray(value.reference.warnings) ? value.reference.warnings.filter((item): item is string => typeof item === "string") : [];
  const currentWarnings = Array.isArray(value.current.warnings) ? value.current.warnings.filter((item): item is string => typeof item === "string") : [];
  const comparisonWarnings = Array.isArray(value.comparison_warnings) ? value.comparison_warnings.filter((item): item is string => typeof item === "string") : [];
  return {
    reference: {
      clipped_sample_percent: numberValue(value.reference.clipped_sample_percent),
      warnings: referenceWarnings,
    },
    current: {
      clipped_sample_percent: numberValue(value.current.clipped_sample_percent),
      warnings: currentWarnings,
    },
    comparison_warnings: comparisonWarnings,
  };
}

function parseDimensions(value: unknown): EvaluationDimension[] | null {
  if (!Array.isArray(value)) return null;
  const dimensions: EvaluationDimension[] = [];
  for (const item of value) {
    if (!isObject(item)) continue;
    const key = stringValue(item.key) as ToneKey;
    if (!TONE_KEYS.has(key)) continue;
    const rawRating = stringValue(item.rating, "unrated") as EvaluationRating;
    dimensions.push({
      key,
      label: stringValue(item.label, TONE_LABELS[key]),
      predicted_difference: numberValue(item.predicted_difference),
      rating: RATINGS.has(rawRating) ? rawRating : "unrated",
    });
  }
  return dimensions.length ? dimensions : null;
}

export function parseEvaluation(value: unknown, sourceName: string): EvaluationRecord {
  if (!isObject(value)) throw new Error("JSONのルートがオブジェクトではありません。");
  const files = parseFiles(value.files);
  const dimensions = parseDimensions(value.dimensions);
  if (!files) throw new Error("参考音・自分の音のファイル名がありません。");
  if (!dimensions) throw new Error("5軸の評価データがありません。");
  if (!isObject(value.alignment)) throw new Error("位置合わせ情報がありません。");
  const rawOverall = stringValue(value.overall) as OverallRating;
  const evaluatedAt = stringValue(value.evaluated_at, new Date(0).toISOString());
  return {
    id: `${evaluatedAt}|${files.reference}|${files.current}|${sourceName}`,
    source_name: sourceName,
    schema_version: Math.max(1, Math.floor(numberValue(value.schema_version, 1))),
    evaluated_at: evaluatedAt,
    files,
    overall: OVERALL.has(rawOverall) ? rawOverall : "",
    notes: stringValue(value.notes),
    alignment: {
      confidence: Math.max(0, Math.min(1, numberValue(value.alignment.confidence))),
      warning: typeof value.alignment.warning === "string" ? value.alignment.warning : null,
    },
    quality: parseQuality(value.quality),
    dimensions,
  };
}

function agreementRate(agree: number, disagree: number) {
  const denominator = agree + disagree;
  return denominator ? agree / denominator : null;
}

function bucketFor(difference: number): DifferenceBucketSummary["key"] {
  const magnitude = Math.abs(difference);
  if (magnitude < 8) return "under_8";
  if (magnitude < 20) return "8_19";
  if (magnitude < 40) return "20_39";
  return "40_plus";
}

export function summarizeEvaluations(records: EvaluationRecord[], targetCount = 20): EvaluationSummary {
  const axisMap = new Map<ToneKey, AxisEvaluationSummary>(
    (Object.keys(TONE_LABELS) as ToneKey[]).map((key) => [key, {
      key,
      label: TONE_LABELS[key],
      agree: 0,
      disagree: 0,
      unsure: 0,
      unrated: 0,
      agreement_rate: null,
    }]),
  );
  const bucketMap = new Map<DifferenceBucketSummary["key"], DifferenceBucketSummary>([
    ["under_8", { key: "under_8", label: "差8未満", agree: 0, disagree: 0, unsure: 0, agreement_rate: null }],
    ["8_19", { key: "8_19", label: "差8〜19", agree: 0, disagree: 0, unsure: 0, agreement_rate: null }],
    ["20_39", { key: "20_39", label: "差20〜39", agree: 0, disagree: 0, unsure: 0, agreement_rate: null }],
    ["40_plus", { key: "40_plus", label: "差40以上", agree: 0, disagree: 0, unsure: 0, agreement_rate: null }],
  ]);
  const overall = { agree: 0, partial: 0, disagree: 0, unrated: 0 };
  let qualityKnownCount = 0;
  let warningRecordCount = 0;
  let lowAlignmentCount = 0;
  const problems: EvaluationProblem[] = [];

  for (const record of records) {
    if (record.overall) overall[record.overall] += 1;
    else overall.unrated += 1;
    const reasons: string[] = [];
    if (record.alignment.confidence < 0.35 || record.alignment.warning) {
      lowAlignmentCount += 1;
      reasons.push(`位置合わせの信頼度が低い（${(record.alignment.confidence * 100).toFixed(0)}%）`);
    }
    if (record.quality) {
      qualityKnownCount += 1;
      const warnings = [
        ...record.quality.reference.warnings,
        ...record.quality.current.warnings,
        ...record.quality.comparison_warnings,
      ];
      if (warnings.length) {
        warningRecordCount += 1;
        reasons.push(`入力警告: ${warnings.join(" / ")}`);
      }
    }
    for (const dimension of record.dimensions) {
      const axis = axisMap.get(dimension.key);
      const bucket = bucketMap.get(bucketFor(dimension.predicted_difference));
      if (!axis || !bucket) continue;
      axis[dimension.rating] += 1;
      if (dimension.rating !== "unrated") bucket[dimension.rating] += 1;
      if (dimension.rating === "disagree") reasons.push(`${dimension.label}の方向が不一致（予測 ${dimension.predicted_difference > 0 ? "+" : ""}${dimension.predicted_difference.toFixed(0)}）`);
      if (dimension.rating === "unsure" && Math.abs(dimension.predicted_difference) >= 20) reasons.push(`${dimension.label}は差が大きい予測でも判断不能`);
    }
    if (record.overall === "disagree") reasons.push("全体評価が「いいえ」");
    if (reasons.length) problems.push({ record_id: record.id, source_name: record.source_name, files: record.files, reasons });
  }

  const axes = [...axisMap.values()].map((axis) => ({
    ...axis,
    agreement_rate: agreementRate(axis.agree, axis.disagree),
  }));
  const buckets = [...bucketMap.values()].map((bucket) => ({
    ...bucket,
    agreement_rate: agreementRate(bucket.agree, bucket.disagree),
  }));

  return {
    record_count: records.length,
    target_count: targetCount,
    overall,
    axes,
    buckets,
    quality_known_count: qualityKnownCount,
    warning_record_count: warningRecordCount,
    low_alignment_count: lowAlignmentCount,
    problems,
  };
}

function csvCell(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function evaluationsCsv(records: EvaluationRecord[]) {
  const rows: (string | number)[][] = [[
    "source", "evaluated_at", "reference", "current", "overall", "alignment_confidence",
    "quality_warning", "axis", "predicted_difference", "rating", "notes",
  ]];
  for (const record of records) {
    const hasWarning = record.quality ? [
      ...record.quality.reference.warnings,
      ...record.quality.current.warnings,
      ...record.quality.comparison_warnings,
    ].length > 0 : "unknown";
    for (const dimension of record.dimensions) {
      rows.push([
        record.source_name,
        record.evaluated_at,
        record.files.reference,
        record.files.current,
        record.overall || "unrated",
        record.alignment.confidence,
        String(hasWarning),
        dimension.key,
        dimension.predicted_difference,
        dimension.rating,
        record.notes,
      ]);
    }
  }
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}
