import assert from "node:assert/strict";
import test from "node:test";
import { aggregateToneResults } from "@/lib/aggregate";
import type { AggregateInput } from "@/lib/aggregate";
import type { ToneKey } from "@/lib/types";

function sample(
  differences: Partial<Record<ToneKey, number>>,
  options: { alignment?: number; warning?: boolean } = {},
): AggregateInput {
  const labels: Record<ToneKey, string> = {
    brightness: "明るさ",
    body: "太さ",
    attack: "アタック",
    compression: "圧縮感",
    roughness: "粗さ",
  };
  const keys = Object.keys(labels) as ToneKey[];
  return {
    alignment: {
      offset_seconds: 0,
      overlap_seconds: 8,
      confidence: options.alignment ?? 0.98,
      warning: null,
    },
    quality: {
      reference: { clipped_sample_percent: 0, warnings: [] },
      current: { clipped_sample_percent: 0, warnings: options.warning ? ["入力警告"] : [] },
      comparison_warnings: [],
    },
    dimensions: keys.map((key) => ({
      key,
      label: labels[key],
      difference: differences[key] ?? 0,
      interpretation: "",
      evidence: [],
      suggestion: "",
    })),
  };
}

test("uses the median so one disturbed take does not dominate", () => {
  const aggregate = aggregateToneResults([
    sample({ brightness: 20 }),
    sample({ brightness: 22 }),
    sample({ brightness: 80 }),
  ]);
  const brightness = aggregate.axes.find((axis) => axis.key === "brightness");
  assert.equal(brightness?.median_difference, 22);
  assert.equal(aggregate.used_take_count, 3);
});

test("stable meaningful differences receive high confidence", () => {
  const aggregate = aggregateToneResults([
    sample({ brightness: 28 }),
    sample({ brightness: 30 }),
    sample({ brightness: 31 }),
  ]);
  const brightness = aggregate.axes.find((axis) => axis.key === "brightness");
  assert.equal(brightness?.confidence, "high");
  assert.ok((brightness?.confidence_score ?? 0) >= 75);
});

test("opposite directions and warnings lower confidence", () => {
  const aggregate = aggregateToneResults([
    sample({ roughness: 24 }),
    sample({ roughness: -21 }, { warning: true }),
    sample({ roughness: 18 }, { alignment: 0.45, warning: true }),
  ]);
  const roughness = aggregate.axes.find((axis) => axis.key === "roughness");
  assert.equal(roughness?.confidence, "low");
  assert.ok((roughness?.direction_agreement ?? 1) < 1);
});

test("single take remains available but is explicitly low confidence", () => {
  const aggregate = aggregateToneResults([sample({ attack: 15 })]);
  const attack = aggregate.axes.find((axis) => axis.key === "attack");
  assert.equal(attack?.median_difference, 15);
  assert.equal(attack?.confidence, "low");
  assert.match(attack?.reason ?? "", /1テイク/);
});

test("only the latest three takes are used", () => {
  const aggregate = aggregateToneResults([
    sample({ body: -80 }),
    sample({ body: 10 }),
    sample({ body: 12 }),
    sample({ body: 14 }),
  ]);
  const body = aggregate.axes.find((axis) => axis.key === "body");
  assert.equal(aggregate.take_count, 4);
  assert.equal(aggregate.used_take_count, 3);
  assert.equal(body?.median_difference, 12);
});
