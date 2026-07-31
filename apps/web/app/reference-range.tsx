"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { buildWaveformEnvelope, decodeAudioFile } from "@/lib/audio-file";
import type { AudioSelection } from "@/lib/types";

const MIN_SELECTION_SECONDS = 1;
const MAX_SELECTION_SECONDS = 30;

function formatTime(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
}

function presetSelection(start: number, length: number, duration: number): AudioSelection {
  const actualLength = Math.min(length, MAX_SELECTION_SECONDS, duration);
  const safeStart = Math.min(Math.max(0, start), Math.max(0, duration - actualLength));
  return { start_seconds: safeStart, end_seconds: safeStart + actualLength };
}

export function ReferenceRangeSelector({
  file,
  selection,
  onChange,
}: {
  file: File;
  selection: AudioSelection | null;
  onChange: (selection: AudioSelection | null) => void;
}) {
  const [duration, setDuration] = useState(0);
  const [waveform, setWaveform] = useState<number[]>([]);
  const [decodeError, setDecodeError] = useState<string | null>(null);
  const [loop, setLoop] = useState(true);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const url = useMemo(() => URL.createObjectURL(file), [file]);

  useEffect(() => {
    let cancelled = false;
    decodeAudioFile(file)
      .then((buffer) => {
        if (cancelled) return;
        setDuration(buffer.duration);
        setWaveform(buildWaveformEnvelope(buffer));
      })
      .catch(() => {
        if (!cancelled) setDecodeError("この音源はブラウザで波形を読み取れません。区間指定なしで比較できます。");
      });
    return () => { cancelled = true; };
  }, [file]);

  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  function updateStart(nextStart: number) {
    if (!selection) return;
    const latestStart = Math.min(nextStart, selection.end_seconds - MIN_SELECTION_SECONDS);
    const end = Math.min(duration, latestStart + MAX_SELECTION_SECONDS, selection.end_seconds);
    onChange({ start_seconds: Math.max(0, end - Math.min(end - latestStart, MAX_SELECTION_SECONDS)), end_seconds: end });
  }

  function updateEnd(nextEnd: number) {
    if (!selection) return;
    const end = Math.max(selection.start_seconds + MIN_SELECTION_SECONDS, Math.min(duration, nextEnd));
    const start = Math.max(0, end - MAX_SELECTION_SECONDS, selection.start_seconds);
    onChange({ start_seconds: start, end_seconds: end });
  }

  function setPreset(length: number) {
    onChange(presetSelection(selection?.start_seconds ?? 0, length, duration));
  }

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio || !selection) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    if (audio.currentTime < selection.start_seconds || audio.currentTime >= selection.end_seconds) {
      audio.currentTime = selection.start_seconds;
    }
    try {
      await audio.play();
    } catch {
      setPlaying(false);
    }
  }

  const startPercent = selection && duration ? (selection.start_seconds / duration) * 100 : 0;
  const widthPercent = selection && duration ? ((selection.end_seconds - selection.start_seconds) / duration) * 100 : 100;

  return (
    <section className="range-selector" aria-labelledby="range-title">
      <div className="range-heading">
        <div>
          <p className="eyebrow">REFERENCE RANGE / 比較区間</p>
          <h3 id="range-title">参考音の使う部分を選ぶ</h3>
        </div>
        {selection ? <button type="button" className="range-clear" onClick={() => onChange(null)}>区間指定を解除</button> : null}
      </div>

      {decodeError ? <p className="range-error" role="status">{decodeError}</p> : null}
      {!decodeError && !duration ? <p className="range-loading">波形を準備中…</p> : null}

      {duration > 0 ? (
        <>
          <div className="range-waveform" aria-label={`音源の長さ ${formatTime(duration)}`}>
            <div className="range-selection-overlay" style={{ left: `${startPercent}%`, width: `${widthPercent}%` }} />
            <svg viewBox={`0 0 ${Math.max(waveform.length, 1)} 100`} preserveAspectRatio="none" aria-hidden="true">
              {waveform.map((value, index) => (
                <line key={index} x1={index + 0.5} x2={index + 0.5} y1={50 - value * 46} y2={50 + value * 46} />
              ))}
            </svg>
          </div>

          {!selection ? (
            <button type="button" className="range-enable" onClick={() => setPreset(10)}>
              10秒の比較区間を指定する
            </button>
          ) : (
            <div className="range-controls">
              <div className="range-presets" role="group" aria-label="区間の長さ">
                {[5, 10, 15].map((seconds) => <button type="button" key={seconds} onClick={() => setPreset(seconds)}>{seconds}秒</button>)}
              </div>
              <label>
                開始 {formatTime(selection.start_seconds)}
                <input type="range" min={0} max={Math.max(0, duration - MIN_SELECTION_SECONDS)} step={0.05} value={selection.start_seconds} onChange={(event) => updateStart(Number(event.target.value))} />
              </label>
              <label>
                終了 {formatTime(selection.end_seconds)}
                <input type="range" min={MIN_SELECTION_SECONDS} max={duration} step={0.05} value={selection.end_seconds} onChange={(event) => updateEnd(Number(event.target.value))} />
              </label>
              <div className="range-playback">
                <button type="button" onClick={() => void togglePlayback()}>{playing ? "停止" : "選択区間を再生"}</button>
                <label><input type="checkbox" checked={loop} onChange={(event) => setLoop(event.target.checked)} />ループ</label>
                <strong>{(selection.end_seconds - selection.start_seconds).toFixed(1)}秒を比較</strong>
              </div>
            </div>
          )}

          <audio
            ref={audioRef}
            src={url}
            preload="metadata"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onEnded={() => setPlaying(false)}
            onTimeUpdate={() => {
              const audio = audioRef.current;
              if (!audio || !selection || audio.currentTime < selection.end_seconds) return;
              if (loop) {
                audio.currentTime = selection.start_seconds;
                void audio.play();
              } else {
                audio.pause();
                audio.currentTime = selection.start_seconds;
              }
            }}
          />
        </>
      ) : null}
    </section>
  );
}
