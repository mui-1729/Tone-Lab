import type { CompareResponse, ToneKey } from "@/lib/types";

export type ConfidenceLevel = "high" | "medium" | "low";

export type AggregateInput = Pick<CompareResponse, "alignment" | "quality" | "dimensions">;

export type AxisAggregate = {
  key: ToneKey;
  label: string;
  median_difference: number;
  median_absolute_deviation: number;
  direction_agreement: number;
  confidence_score: number;
  confidence: ConfidenceLevel;
  reason: string;
  sample_count: number;
};

export type MultiTakeAggregate = {
  take_count: number;
  used_take_count: number;
  representative_distance: number;
  axes: AxisAggregate[];
};

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, value));
}

function direction(value: number) {
  if (Math.abs(value) < 8) return 0;
  return value > 0 ? 1 : -1;
}

function confidenceLevel(score: number): ConfidenceLevel {
  if (score >= 75) return "high";
  if (score >= 50) return "medium";
  return "low";
}

function confidenceReason({
  sampleCount,
  medianDifference,
  deviation,
  agreement,
  warningRate,
  alignment,
}: {
  sampleCount: number;
  medianDifference: number;
  deviation: number;
  agreement: number;
  warningRate: number;
  alignment: number;
}) {
  if (sampleCount === 1) return "1テイクのみのため、演奏差をまだ分離できません。";
  if (alignment < 0.5) return "フレーズの一致度が低く、比較位置の影響を受けています。";
  if (warningRate > 0.34) return "入力品質の警告を含むテイクが多くあります。";
  if (agreement < 0.67) return "テイクごとに差の方向が安定していません。";
  if (deviation >= 8) return "演奏ごとのばらつきが大きく、代表値が安定していません。";
  if (Math.abs(medianDifference) < 8) return "差が小さいため、近いことは示せても方向の断定には向きません。";
  return "複数テイクで方向と大きさが安定しています。";
}

export function aggregateToneResults(inputs: AggregateInput[], maxTakes = 3): MultiTakeAggregate {
  const usedInputs = inputs.slice(-Math.max(1, maxTakes));
  if (!usedInputs.length) return { take_count: 0, used_take_count: 0, representative_distance: 0, axes: [] };

  const firstDimensions = usedInputs[0].dimensions;
  const axes = firstDimensions.map((firstDimension) => {
    const values = usedInputs.map((input) => input.dimensions.find((dimension) => dimension.key === firstDimension.key)?.difference ?? 0);
    const medianDifference = median(values);
    const deviation = median(values.map((value) => Math.abs(value - medianDifference)));
    const targetDirection = direction(medianDifference);
    const agreeing = values.filter((value) => direction(value) === targetDirection).length;
    const agreement = agreeing / values.length;
    const meanAlignment = usedInputs.reduce((total, input) => total + input.alignment.confidence, 0) / usedInputs.length;
    const warningCount = usedInputs.filter((input) => (
      input.quality.reference.warnings.length
      + input.quality.current.warnings.length
      + input.quality.comparison_warnings.length
    ) > 0).length;
    const warningRate = warningCount / usedInputs.length;

    let score = meanAlignment * 100;
    score -= Math.min(35, deviation * 2.5);
    score -= (1 - agreement) * 30;
    score -= warningRate * 25;
    if (usedInputs.length === 1) score = Math.min(score, 48);
    if (usedInputs.length === 2) score = Math.min(score, 78);
    if (Math.abs(medianDifference) < 8) score = Math.min(score, 64);
    score = clamp(score);

    return {
      key: firstDimension.key,
      label: firstDimension.label,
      median_difference: medianDifference,
      median_absolute_deviation: deviation,
      direction_agreement: agreement,
      confidence_score: score,
      confidence: confidenceLevel(score),
      reason: confidenceReason({
        sampleCount: usedInputs.length,
        medianDifference,
        deviation,
        agreement,
        warningRate,
        alignment: meanAlignment,
      }),
      sample_count: usedInputs.length,
    } satisfies AxisAggregate;
  });

  return {
    take_count: inputs.length,
    used_take_count: usedInputs.length,
    representative_distance: axes.reduce((total, axis) => total + Math.abs(axis.median_difference), 0),
    axes,
  };
}
