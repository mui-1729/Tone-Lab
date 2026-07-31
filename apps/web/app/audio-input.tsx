"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { audioBufferToWavFile } from "@/lib/wav";

const ACCEPT = ".wav,.mp3,.flac,.ogg,audio/wav,audio/mpeg,audio/flac,audio/ogg";

type InputMode = "file" | "record";
type RecorderStatus = "idle" | "preparing" | "ready" | "countdown" | "recording" | "processing";

function formatSeconds(value: number) {
  return `${Math.floor(value / 60)}:${Math.floor(value % 60).toString().padStart(2, "0")}`;
}

function preferredMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  return ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]
    .find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export function AudioInput({
  id,
  label,
  file,
  onChange,
  recordingLimitSeconds = 30,
}: {
  id: string;
  label: string;
  file: File | null;
  onChange: (file: File | null) => void;
  recordingLimitSeconds?: number;
}) {
  const recordingLimit = Math.max(1, Math.min(30, recordingLimitSeconds));
  const [mode, setMode] = useState<InputMode>("file");
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [clipped, setClipped] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const animationRef = useRef<number | null>(null);
  const elapsedTimerRef = useRef<number | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const countdownTimerRef = useRef<number | null>(null);
  const recordingStartedRef = useRef(0);
  const requestRef = useRef(0);
  const clippedRef = useRef(false);

  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  const clearTimers = useCallback(() => {
    if (elapsedTimerRef.current !== null) window.clearInterval(elapsedTimerRef.current);
    if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current);
    if (countdownTimerRef.current !== null) window.clearInterval(countdownTimerRef.current);
    elapsedTimerRef.current = null;
    stopTimerRef.current = null;
    countdownTimerRef.current = null;
  }, []);

  const releaseInput = useCallback(() => {
    requestRef.current += 1;
    clearTimers();
    if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    animationRef.current = null;
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.stop();
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void contextRef.current?.close();
    contextRef.current = null;
  }, [clearTimers]);

  useEffect(() => () => releaseInput(), [releaseInput]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const startLevelMeter = useCallback((context: AudioContext, stream: MediaStream) => {
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let lastUpdate = 0;

    const draw = (timestamp: number) => {
      analyser.getFloatTimeDomainData(samples);
      let peak = 0;
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
      if (timestamp - lastUpdate >= 80) {
        setLevel(Math.min(1, peak));
        lastUpdate = timestamp;
      }
      if (peak >= 0.99 && !clippedRef.current) {
        clippedRef.current = true;
        setClipped(true);
      }
      animationRef.current = requestAnimationFrame(draw);
    };

    animationRef.current = requestAnimationFrame(draw);
  }, []);

  const prepareInput = useCallback(async (deviceId?: string) => {
    releaseInput();
    const requestId = requestRef.current;
    setStatus("preparing");
    setError(null);
    setWarning(null);
    setLevel(0);

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setStatus("idle");
      setError("このブラウザは音声録音に対応していません。Chromeの最新版かファイル入力を使用してください。");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: { ideal: 1 },
          sampleRate: { ideal: 48_000 },
        },
      });
      if (requestId !== requestRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const context = new AudioContext();
      await context.resume();
      streamRef.current = stream;
      contextRef.current = context;
      startLevelMeter(context, stream);

      const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((item) => item.kind === "audioinput");
      setDevices(inputs);
      const settings = stream.getAudioTracks()[0]?.getSettings();
      setSelectedDeviceId(settings?.deviceId ?? deviceId ?? "");

      const enabledProcessing = [
        settings?.echoCancellation ? "エコーキャンセル" : null,
        settings?.noiseSuppression ? "ノイズ抑制" : null,
        settings?.autoGainControl ? "自動音量調整" : null,
      ].filter(Boolean);
      setWarning(enabledProcessing.length
        ? `${enabledProcessing.join("・")}が有効です。音色やダイナミクスの解析精度が下がる可能性があります。`
        : null);
      setStatus("ready");
    } catch (caught) {
      setStatus("idle");
      const name = caught instanceof DOMException ? caught.name : "";
      if (name === "NotAllowedError") {
        setError("マイクの利用が許可されませんでした。Chromeのサイト設定からマイクを許可してください。");
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setError("選択した音声入力を利用できません。接続を確認して入力を準備し直してください。");
      } else {
        setError("音声入力を開始できませんでした。別の入力機器またはファイル入力を試してください。");
      }
    }
  }, [releaseInput, startLevelMeter]);

  const finishRecording = useCallback(async (blob: Blob) => {
    setStatus("processing");
    const decodeContext = new AudioContext();
    try {
      const audioBuffer = await decodeContext.decodeAudioData(await blob.arrayBuffer());
      const recording = audioBufferToWavFile(
        audioBuffer,
        `tone-lab-${id}-${new Date().toISOString().replace(/[:.]/g, "-")}.wav`,
      );
      onChange(recording);
      setStatus("ready");
    } catch {
      setStatus("ready");
      setError("録音データをWAVへ変換できませんでした。録り直すかファイル入力を使用してください。");
    } finally {
      await decodeContext.close();
    }
  }, [id, onChange]);

  const stopRecording = useCallback(() => {
    clearTimers();
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
  }, [clearTimers]);

  const beginRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) {
      setStatus("idle");
      setError("音声入力が切断されました。録音を準備し直してください。");
      return;
    }
    const mimeType = preferredMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    chunksRef.current = [];
    clippedRef.current = false;
    setClipped(false);
    setElapsed(0);
    setError(null);
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || "audio/webm" });
      void finishRecording(blob);
    };
    recorder.start(250);
    recordingStartedRef.current = performance.now();
    setStatus("recording");
    elapsedTimerRef.current = window.setInterval(() => {
      setElapsed((performance.now() - recordingStartedRef.current) / 1000);
    }, 100);
    stopTimerRef.current = window.setTimeout(stopRecording, recordingLimit * 1000);
  }, [finishRecording, recordingLimit, stopRecording]);

  const startCountdown = useCallback(() => {
    if (!streamRef.current || status !== "ready") return;
    setStatus("countdown");
    setCountdown(3);
    let remaining = 3;
    countdownTimerRef.current = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        if (countdownTimerRef.current !== null) window.clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
        beginRecording();
      } else {
        setCountdown(remaining);
      }
    }, 1000);
  }, [beginRecording, status]);

  function switchMode(nextMode: InputMode) {
    if (status === "recording" || status === "countdown" || status === "processing") return;
    if (nextMode === "file") {
      releaseInput();
      setStatus("idle");
      setLevel(0);
    }
    setMode(nextMode);
    setError(null);
  }

  return (
    <section className="audio-card">
      <div>
        <p className="eyebrow">{label}</p>
        <p className="file-name">{file?.name ?? "音源を選択または録音してください"}</p>
      </div>

      <div className="input-mode-tabs" role="tablist" aria-label={`${label}の入力方法`}>
        <button type="button" role="tab" aria-selected={mode === "file"} className={mode === "file" ? "active" : ""} onClick={() => switchMode("file")}>ファイル</button>
        <button type="button" role="tab" aria-selected={mode === "record"} className={mode === "record" ? "active" : ""} onClick={() => switchMode("record")}>録音</button>
      </div>

      {mode === "file" ? (
        <>
          <label className="file-button" htmlFor={id}>ファイルを選ぶ</label>
          <input
            key={file ? `${file.name}-${file.lastModified}` : "empty"}
            id={id}
            className="sr-only"
            type="file"
            accept={ACCEPT}
            onChange={(event) => onChange(event.target.files?.[0] ?? null)}
          />
        </>
      ) : (
        <div className="recorder-panel">
          {devices.length ? (
            <label className="device-select">
              入力機器
              <select
                value={selectedDeviceId}
                disabled={status === "recording" || status === "countdown" || status === "processing"}
                onChange={(event) => {
                  const value = event.target.value;
                  setSelectedDeviceId(value);
                  void prepareInput(value);
                }}
              >
                {devices.map((device, index) => (
                  <option value={device.deviceId} key={device.deviceId || index}>
                    {device.label || `音声入力 ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="input-meter" aria-label={`入力レベル ${Math.round(level * 100)}%`}>
            <span style={{ width: `${Math.max(1, level * 100)}%` }} />
          </div>
          <div className="recorder-meta">
            <span>{status === "recording" ? `${formatSeconds(elapsed)} / ${formatSeconds(recordingLimit)}` : `最大${recordingLimit.toFixed(1)}秒`}</span>
            <span className={clipped ? "clip-active" : ""}>{clipped ? "クリップ検出" : "入力レベルを確認"}</span>
          </div>

          {status === "idle" ? <button type="button" className="record-secondary" onClick={() => void prepareInput()}>録音を準備</button> : null}
          {status === "preparing" ? <button type="button" className="record-secondary" disabled>入力を準備中…</button> : null}
          {status === "ready" ? <button type="button" className="record-primary" onClick={startCountdown}>{file ? "3秒後に録り直す" : "3秒後に録音"}</button> : null}
          {status === "countdown" ? <div className="countdown" role="status">{countdown}</div> : null}
          {status === "recording" ? <button type="button" className="record-stop" onClick={stopRecording}>録音を停止</button> : null}
          {status === "processing" ? <button type="button" className="record-secondary" disabled>WAVへ変換中…</button> : null}
          {warning ? <p className="record-warning" role="status">{warning}</p> : null}
          {error ? <p className="record-error" role="alert">{error}</p> : null}
        </div>
      )}

      {previewUrl ? <audio className="audio-player" controls src={previewUrl} /> : null}
    </section>
  );
}
