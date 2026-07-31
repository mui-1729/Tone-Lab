import assert from "node:assert/strict";
import test from "node:test";
import { appendRollingPcm, copyRollingTail, peakLevel, rmsDbfs } from "@/lib/live";

test("keeps only the requested number of latest samples", () => {
  let state = { chunks: [] as Float32Array[], sample_count: 0 };
  state = appendRollingPcm(state, Float32Array.from([1, 2, 3]), 5);
  state = appendRollingPcm(state, Float32Array.from([4, 5, 6, 7]), 5);
  assert.equal(state.sample_count, 5);
  assert.deepEqual([...copyRollingTail(state, 5)], [3, 4, 5, 6, 7]);
});

test("copies a shorter tail without mutating the rolling state", () => {
  const state = appendRollingPcm(
    { chunks: [], sample_count: 0 },
    Float32Array.from([0.1, 0.2, 0.3, 0.4]),
    10,
  );
  assert.deepEqual([...copyRollingTail(state, 2)], [0.3, 0.4]);
  assert.equal(state.sample_count, 4);
});

test("calculates RMS dBFS and peak level", () => {
  const samples = Float32Array.from([0.5, -0.5, 0.5, -0.5]);
  assert.ok(Math.abs(rmsDbfs(samples) - -6.0206) < 0.001);
  assert.equal(peakLevel(samples), 0.5);
  assert.equal(rmsDbfs(new Float32Array()), Number.NEGATIVE_INFINITY);
});
