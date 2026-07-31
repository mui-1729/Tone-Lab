"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { aggregateToneResults } from "@/lib/aggregate";
import type { MultiTakeAggregate } from "@/lib/aggregate";
import { compareAudio } from "@/lib/api";
import { appendRollingPcm, copyRollingTail, peakLevel, rmsDbfs } from "@/lib/live";
import type { RollingPcm } from "@/lib/live";
import type { ToneSession } from "@/lib/session";
import type { CompareResponse } from "@/lib/types";
import { audioBufferToWavFile } from "@/lib/wav";

const WINDOW_SECONDS = 4;
const MIN_ANALYSIS_SECONDS = 3;
const UPDATE_INTERVAL_MS = 1_000;
const SILENCE_THRESHOLD_DBFS = -55;
const RESULT_HISTORY = 5;

type LiveStatus = "idle" | "preparing" | "ready" | "running" | "stopping";

function confidenceLabel(value: number) {
  if (value >= 75) return "高";
  if (value >= 50) return "中";
  return "低";
}

function directionText(value: number) {
  if (Math.abs(value) < 8) return "参考音に近い";
  return value > 0 ? "自分の音が強い" : "参考音が強い";
}

function createWav(samples: Float32Array, sampleRate: number, filename: string) {
  const buffer = new AudioBuffer({ length: samples.length, numberOfChannels: 1, sampleRate });
  buffer.copyToChannel(samples, 0);
  return audioBufferToWavFile(buffer, filename);
}

export function LiveComparison({
  session,
  onSaveTake,
}: {
  session: ToneSession;
  onSaveTake: (file: File, result: CompareResponse) => Promise<void>;
}) {
  const [status, setStatus] = useState<LiveStatus>("idle");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [level, setLevel] = useState(0);
  const [clipped, setClipped] = useState(false);
  const [processingWarning, setProcessingWarning] = useState<string | null>(null);
  const [message, setMessage] = useState("入力を準備すると、直近4秒を約1秒ごとに比較します。");
  const [error, setError] = useState<string | null>(null);
  const [aggregate, setAggregate] = useState<MultiTakeAggregate | null>(null);
  const [updateCount, setUpdateCount] = useState(0);
  const [saved, setSaved] = useState(false);

  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const workletRef = useRef<AudioWorkletNode | null>(null);
  const intervalRef = useRef<number | null>(null);
  const rollingRef = useRef<RollingPcm>({ chunks: [], sample_count: 0 });
  const recentResultsRef = useRef<CompareResponse[]>([]);
  const latestResultRef = useRef<CompareResponse | null>(null);
  const latestFileRef = useRef<File | null>(null);
  const inFlightRef = useRef(false);
  const runningRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const lastMeterUpdateRef = useRef(0);
  const clippedRef = useRef(false);

  const clearIntervalTimer = useCallback(() => {
    if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
    intervalRef.current = null;
  }, []);

  const releaseInput = useCallback(() => {
    generationRef.current += 1;
    runningRef.current = false;
    clearIntervalTimer();
    abortRef.current?.abort();
    abortRef.current = null;
    workletRef.current?.port.close();
    workletRef.current?.disconnect();
    workletRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const context = contextRef.current;
    contextRef.current = null;
    if (context && context.state !== "closed") void context.close();
    inFlightRef.current = false;
  }, [clearIntervalTimer]);

  useEffect(() => () => releaseInput(), [releaseInput]);

  const analyzeSamples = useCallback(async (
    samples: Float32Array,
    sampleRate: number,
    finalAnalysis: boolean,
  ) => {
    const duration = samples.length / sampleRate;
    if (duration < MIN_ANALYSIS_SECONDS) {
      if (!finalAnalysis) setMessage(`解析開始まであと${Math.max(0, MIN_ANALYSIS_SECONDS - duration).toFixed(1)}秒`);
      return null;
    }
    const signalLevel = rmsDbfs(samples);
    if (signalLevel < SILENCE_THRESHOLD_DBFS) {
      if (!finalAnalysis) setMessage("入力が小さいため更新を保留しています。ギターを弾くと再開します。");
      return null;
    }

    const filename = `tone-lab-live-${new Date().toISOString().replace(/[:.]/g, "-")}.wav`;
    const file = createWav(samples, sampleRate, filename);
    const controller = new AbortController();
    abortRef.current = controller;
    const generation = generationRef.current;
    inFlightRef.current = true;
    if (!finalAnalysis) setMessage("直近4秒を解析中…");
    try {
      const result = await compareAudio(session.analyzed_reference_file, file, controller.signal);
      if (generation !== generationRef.current && !finalAnalysis) return null;
      latestResultRef.current = result;
      latestFileRef.current = file;
      recentResultsRef.current = [...recentResultsRef.current, result].slice(-RESULT_HISTORY);
      setAggregate(aggregateToneResults(recentResultsRef.current));
      setUpdateCount((value) => value + 1);
      setMessage(`更新完了・入力 ${signalLevel.toFixed(1)} dBFS`);
      return { file, result };
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return null;
      if (!finalAnalysis) setError(caught instanceof Error ? caught.message : "リアルタイム解析に失敗しました。");
      return null;
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      inFlightRef.current = false;
    }
  }, [session.analyzed_reference_file]);

  const analyzeCurrentWindow = useCallback(() => {
    const context = contextRef.current;
    if (!runningRef.current || !context || inFlightRef.current) return;
    const samples = copyRollingTail(rollingRef.current, Math.floor(context.sampleRate * WINDOW_SECONDS));
    void analyzeSamples(samples, context.sampleRate, false);
  }, [analyzeSamples]);

  const prepareInput = useCallback(async (deviceId?: string) => {
    releaseInput();
    setStatus("preparing");
    setError(null);
    setProcessingWarning(null);
    setMessage("音声入力を準備中…");
    setLevel(0);
    setClipped(false);
    clippedRef.current = false;

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) {
      setStatus("idle");
      setError("リアルタイム比較には、localhostまたはHTTPS上の対応ブラウザが必要です。通常の録音比較を使用してください。");
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
      const context = new AudioContext({ latencyHint: "interactive" });
      await context.audioWorklet.addModule("/tone-lab-pcm-worklet.js");
      await context.resume();
      const source = context.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(context, "tone-lab-pcm");
      const silentOutput = context.createGain();
      silentOutput.gain.value = 0;
      source.connect(worklet);
      worklet.connect(silentOutput);
      silentOutput.connect(context.destination);

      streamRef.current = stream;
      contextRef.current = context;
      workletRef.current = worklet;
      rollingRef.current = { chunks: [], sample_count: 0 };
      worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
        const chunk = event.data;
        rollingRef.current = appendRollingPcm(
          rollingRef.current,
          chunk,
          Math.floor(context.sampleRate * WINDOW_SECONDS),
        );
        const now = performance.now();
        if (now - lastMeterUpdateRef.current >= 80) {
          setLevel(peakLevel(chunk));
          lastMeterUpdateRef.current = now;
        }
        if (!clippedRef.current && peakLevel(chunk) >= 0.99) {
          clippedRef.current = true;
          setClipped(true);
        }
      };

      const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audioinput");
      setDevices(inputs);
      const settings = stream.getAudioTracks()[0]?.getSettings();
      setSelectedDeviceId(settings?.deviceId ?? deviceId ?? "");
      const enabledProcessing = [
        settings?.echoCancellation ? "エコーキャンセル" : null,
        settings?.noiseSuppression ? "ノイズ抑制" : null,
        settings?.autoGainControl ? "自動音量調整" : null,
      ].filter(Boolean);
      setProcessingWarning(enabledProcessing.length
        ? `${enabledProcessing.join("・")}が有効です。音色とダイナミクスの比較精度が下がる可能性があります。`
        : null);
      setStatus("ready");
      setMessage("入力準備完了。開始後、3秒以上弾くと判定が表示されます。");
    } catch (caught) {
      releaseInput();
      setStatus("idle");
      const name = caught instanceof DOMException ? caught.name : "";
      if (name === "NotAllowedError") setError("音声入力が許可されませんでした。Chromeのサイト設定からマイクを許可してください。");
      else if (name === "NotFoundError" || name === "OverconstrainedError") setError("選択した音声入力を利用できません。接続を確認してください。");
      else setError(caught instanceof Error ? caught.message : "リアルタイム入力を開始できませんでした。");
    }
  }, [releaseInput]);

  function startLive() {
    if (!contextRef.current || status !== "ready") return;
    generationRef.current += 1;
    rollingRef.current = { chunks: [], sample_count: 0 };
    recentResultsRef.current = [];
    latestResultRef.current = null;
    latestFileRef.current = null;
    setAggregate(null);
    setUpdateCount(0);
    setSaved(false);
    setError(null);
    setMessage("演奏を待っています。3秒以上続けて弾いてください。");
    runningRef.current = true;
    setStatus("running");
    intervalRef.current = window.setInterval(analyzeCurrentWindow, UPDATE_INTERVAL_MS);
  }

  async function stopLive() {
    const context = contextRef.current;
    if (!context || (status !== "running" && status !== "ready")) {
      releaseInput();
      setStatus("idle");
      return;
    }
    setStatus("stopping");
    runningRef.current = false;
    clearIntervalTimer();
    abortRef.current?.abort();
    const samples = copyRollingTail(rollingRef.current, Math.floor(context.sampleRate * WINDOW_SECONDS));
    const sampleRate = context.sampleRate;
    releaseInput();
    setMessage("最後の安定区間を解析して保存中…");
    const finalResult = await analyzeSamples(samples, sampleRate, true);
    const fallback = latestResultRef.current && latestFileRef.current
      ? { result: latestResultRef.current, file: latestFileRef.current }
      : null;
    const value = finalResult ?? fallback;
    if (value) {
      try {
        await onSaveTake(value.file, value.result);
        setSaved(true);
        setMessage("最後の解析結果を通常テイクとして端末内セッションへ保存しました。");
      } catch {
        setError("最終結果をセッションへ保存できませんでした。");
      }
    } else {
      setMessage("保存できる解析結果がありません。3秒以上、十分な音量で演奏してください。");
    }
    setStatus("idle");
  }

  const stability = aggregate?.axes.length
    ? aggregate.axes.reduce((total, axis) => total + axis.confidence_score, 0) / aggregate.axes.length
    : 0;

  return (
    <section className="live-comparison" aria-labelledby="live-title">
      <div className="live-heading">
        <div>
          <p className="eyebrow">LIVE MODE / リアルタイム比較</p>
          <h2 id="live-title">弾きながら差を確認</h2>
          <p>直近4秒の演奏を約1秒ごとに解析し、最大5回の中央値で表示の揺れを抑えます。</p>
        </div>
        <div className="live-stability"><strong>{aggregate ? `${stability.toFixed(0)}%` : "—"}</strong><span>表示安定度</span></div>
      </div>

      {devices.length ? (
        <label className="live-device">
          入力機器
          <select value={selectedDeviceId} disabled={status === "running" || status === "stopping"} onChange={(event) => void prepareInput(event.target.value)}>
            {devices.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `音声入力 ${index + 1}`}</option>)}
          </select>
        </label>
      ) : null}

      <div className="live-meter" aria-label={`ライブ入力レベル ${Math.round(level * 100)}%`}><span style={{ width: `${Math.max(1, level * 100)}%` }} /></div>
      <div className="live-meta"><span>{message}</span><strong className={clipped ? "clip-active" : ""}>{clipped ? "クリップ検出" : `${updateCount}回更新`}</strong></div>

      {processingWarning ? <p className="live-warning" role="status">{processingWarning}</p> : null}
      {error ? <p className="live-error" role="alert">{error}</p> : null}

      <div className="live-actions">
        {status === "idle" ? <button type="button" onClick={() => void prepareInput()}>入力を準備</button> : null}
        {status === "preparing" ? <button type="button" disabled>準備中…</button> : null}
        {status === "ready" ? <><button type="button" className="live-start" onClick={startLive}>リアルタイム比較を開始</button><button type="button" onClick={() => void stopLive()}>入力を終了</button></> : null}
        {status === "running" ? <button type="button" className="live-stop" onClick={() => void stopLive()}>停止して結果を保存</button> : null}
        {status === "stopping" ? <button type="button" disabled>最終解析中…</button> : null}
      </div>

      {aggregate?.axes.length ? (
        <div className="live-axis-grid" aria-live="polite">
          {aggregate.axes.map((axis) => (
            <article key={axis.key} className={`confidence-${axis.confidence}`}>
              <span>{axis.label}</span>
              <strong>{axis.median_difference > 0 ? "+" : ""}{axis.median_difference.toFixed(0)}</strong>
              <p>{directionText(axis.median_difference)}</p>
              <small>信頼度 {confidenceLabel(axis.confidence_score)} {axis.confidence_score.toFixed(0)}% / ばらつき ±{axis.median_absolute_deviation.toFixed(1)}</small>
            </article>
          ))}
        </div>
      ) : <p className="live-empty">開始後、無音を除いた3〜4秒の演奏がたまると5軸が表示されます。</p>}

      {saved ? <p className="live-saved" role="status">通常のテイク履歴、A/B試聴、レポートへ反映済みです。</p> : null}
      <p className="live-note">通信や解析が1秒を超える場合は重複リクエストを行わず、完了後の次の窓から更新します。通常比較はいつでも引き続き利用できます。</p>
    </section>
  );
}
