export type RollingPcm = {
  chunks: Float32Array[];
  sample_count: number;
};

export function appendRollingPcm(
  state: RollingPcm,
  chunk: Float32Array,
  maxSamples: number,
): RollingPcm {
  if (!chunk.length || maxSamples <= 0) return state;
  const chunks = [...state.chunks, chunk];
  let sampleCount = state.sample_count + chunk.length;
  while (chunks.length > 1 && sampleCount - chunks[0].length >= maxSamples) {
    sampleCount -= chunks[0].length;
    chunks.shift();
  }
  if (sampleCount > maxSamples && chunks.length) {
    const excess = sampleCount - maxSamples;
    chunks[0] = chunks[0].slice(excess);
    sampleCount = maxSamples;
  }
  return { chunks, sample_count: sampleCount };
}

export function copyRollingTail(state: RollingPcm, tailSamples: number) {
  const length = Math.max(0, Math.min(state.sample_count, tailSamples));
  const output = new Float32Array(length);
  let writeOffset = length;
  for (let index = state.chunks.length - 1; index >= 0 && writeOffset > 0; index -= 1) {
    const chunk = state.chunks[index];
    const take = Math.min(chunk.length, writeOffset);
    writeOffset -= take;
    output.set(chunk.subarray(chunk.length - take), writeOffset);
  }
  return output;
}

export function rmsDbfs(samples: Float32Array) {
  if (!samples.length) return Number.NEGATIVE_INFINITY;
  let sumSquares = 0;
  for (const sample of samples) sumSquares += sample * sample;
  const rms = Math.sqrt(sumSquares / samples.length);
  return rms > 0 ? 20 * Math.log10(rms) : Number.NEGATIVE_INFINITY;
}

export function peakLevel(samples: Float32Array) {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return Math.min(1, peak);
}
