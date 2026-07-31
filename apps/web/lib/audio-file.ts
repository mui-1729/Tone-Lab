import type { AudioSelection } from "@/lib/types";
import { audioBufferToWavFile } from "@/lib/wav";

export async function decodeAudioFile(file: File) {
  const context = new AudioContext();
  try {
    return await context.decodeAudioData(await file.arrayBuffer());
  } finally {
    await context.close();
  }
}

export async function sliceAudioFile(file: File, selection: AudioSelection) {
  const buffer = await decodeAudioFile(file);
  const stem = file.name.replace(/\.[^.]+$/, "") || "reference";
  return audioBufferToWavFile(buffer, `${stem}_selection.wav`, selection);
}

export function buildWaveformEnvelope(buffer: AudioBuffer, pointCount = 180) {
  const points = Math.max(16, pointCount);
  const channelCount = Math.max(1, buffer.numberOfChannels);
  const framesPerPoint = Math.max(1, Math.floor(buffer.length / points));
  const values: number[] = [];

  for (let point = 0; point < points; point += 1) {
    const start = point * framesPerPoint;
    const end = point === points - 1 ? buffer.length : Math.min(buffer.length, start + framesPerPoint);
    let sumSquares = 0;
    let sampleCount = 0;
    for (let channel = 0; channel < channelCount; channel += 1) {
      const samples = buffer.getChannelData(channel);
      for (let frame = start; frame < end; frame += 1) {
        sumSquares += samples[frame] * samples[frame];
        sampleCount += 1;
      }
    }
    values.push(sampleCount ? Math.sqrt(sumSquares / sampleCount) : 0);
  }

  const max = Math.max(...values, Number.EPSILON);
  return values.map((value) => value / max);
}
