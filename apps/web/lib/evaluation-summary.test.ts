import assert from "node:assert/strict";
import test from "node:test";
import { evaluationsCsv, parseEvaluation, summarizeEvaluations } from "@/lib/evaluation-summary";

function evaluation(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 3,
    evaluated_at: "2026-07-31T00:00:00.000Z",
    files: { reference: "reference.wav", current: "current.wav" },
    overall: "agree",
    notes: "",
    alignment: { confidence: 0.95, warning: null },
    quality: {
      reference: { clipped_sample_percent: 0, warnings: [] },
      current: { clipped_sample_percent: 0, warnings: [] },
      comparison_warnings: [],
    },
    dimensions: [
      { key: "brightness", label: "明るさ", predicted_difference: 32, rating: "agree" },
      { key: "body", label: "太さ", predicted_difference: 5, rating: "unsure" },
    ],
    ...overrides,
  };
}

test("parses current and older evaluation JSON with missing quality", () => {
  const current = parseEvaluation(evaluation(), "current.json");
  assert.equal(current.quality?.current.warnings.length, 0);
  const legacy = parseEvaluation(evaluation({ schema_version: 1, quality: undefined }), "legacy.json");
  assert.equal(legacy.schema_version, 1);
  assert.equal(legacy.quality, null);
});

test("rejects unrelated or incomplete JSON", () => {
  assert.throws(() => parseEvaluation({ hello: "world" }, "wrong.json"), /ファイル名/);
});

test("calculates agreement rates with agree plus disagree as denominator", () => {
  const records = [
    parseEvaluation(evaluation(), "a.json"),
    parseEvaluation(evaluation({
      overall: "partial",
      dimensions: [
        { key: "brightness", label: "明るさ", predicted_difference: 35, rating: "disagree" },
        { key: "body", label: "太さ", predicted_difference: 4, rating: "unrated" },
      ],
    }), "b.json"),
    parseEvaluation(evaluation({
      dimensions: [
        { key: "brightness", label: "明るさ", predicted_difference: 33, rating: "unsure" },
      ],
    }), "c.json"),
  ];
  const summary = summarizeEvaluations(records);
  const brightness = summary.axes.find((axis) => axis.key === "brightness");
  assert.equal(brightness?.agree, 1);
  assert.equal(brightness?.disagree, 1);
  assert.equal(brightness?.unsure, 1);
  assert.equal(brightness?.agreement_rate, 0.5);
});

test("groups predictions by magnitude and surfaces problematic records", () => {
  const record = parseEvaluation(evaluation({
    alignment: { confidence: 0.2, warning: "一致度が低い" },
    dimensions: [
      { key: "roughness", label: "粗さ", predicted_difference: 45, rating: "disagree" },
    ],
  }), "problem.json");
  const summary = summarizeEvaluations([record]);
  const large = summary.buckets.find((bucket) => bucket.key === "40_plus");
  assert.equal(large?.disagree, 1);
  assert.equal(summary.low_alignment_count, 1);
  assert.equal(summary.problems.length, 1);
  assert.match(summary.problems[0].reasons.join(" "), /粗さ/);
});

test("exports one CSV row per evaluated axis", () => {
  const csv = evaluationsCsv([parseEvaluation(evaluation(), "source.json")]);
  assert.match(csv, /brightness,32,agree/);
  assert.match(csv, /body,5,unsure/);
});
