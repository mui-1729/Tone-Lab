export {};

declare global {
  interface AudioBuffer {
    copyToChannel(
      source: Float32Array<ArrayBufferLike>,
      channelNumber: number,
      bufferOffset?: number,
    ): void;
  }
}
