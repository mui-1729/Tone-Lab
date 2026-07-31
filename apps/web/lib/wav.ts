function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

export function audioBufferToWavFile(buffer: AudioBuffer, filename: string) {
  const channelCount = Math.max(1, buffer.numberOfChannels);
  const frameCount = buffer.length;
  const mono = new Float32Array(frameCount);

  for (let channel = 0; channel < channelCount; channel += 1) {
    const samples = buffer.getChannelData(channel);
    for (let frame = 0; frame < frameCount; frame += 1) {
      mono[frame] += samples[frame] / channelCount;
    }
  }

  const bytesPerSample = 2;
  const dataBytes = frameCount * bytesPerSample;
  const arrayBuffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(arrayBuffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  for (let frame = 0; frame < frameCount; frame += 1) {
    const sample = Math.max(-1, Math.min(1, mono[frame]));
    const integer = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    view.setInt16(44 + frame * bytesPerSample, Math.round(integer), true);
  }

  return new File([arrayBuffer], filename, {
    type: "audio/wav",
    lastModified: Date.now(),
  });
}
