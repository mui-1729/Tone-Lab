"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CompareResponse } from "@/lib/types";

type Side = "reference" | "current";

function formatTime(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
}

function volumeFor(rmsDbfs: number, targetDbfs: number) {
  return Math.max(0, Math.min(1, 10 ** ((targetDbfs - rmsDbfs) / 20)));
}

export function ABAudition({
  referenceFile,
  currentFile,
  result,
}: {
  referenceFile: File;
  currentFile: File;
  result: CompareResponse;
}) {
  const referenceUrl = useMemo(() => URL.createObjectURL(referenceFile), [referenceFile]);
  const currentUrl = useMemo(() => URL.createObjectURL(currentFile), [currentFile]);
  const referenceAudio = useRef<HTMLAudioElement>(null);
  const currentAudio = useRef<HTMLAudioElement>(null);
  const [active, setActive] = useState<Side>("reference");
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [levelMatched, setLevelMatched] = useState(true);

  const offset = result.alignment.offset_seconds;
  const starts: Record<Side, number> = {
    reference: offset < 0 ? -offset : 0,
    current: offset > 0 ? offset : 0,
  };
  const duration = result.alignment.overlap_seconds;

  function element(side: Side) {
    return side === "reference" ? referenceAudio.current : currentAudio.current;
  }

  function alignedPosition(side: Side) {
    const audio = element(side);
    return Math.max(0, Math.min(duration, (audio?.currentTime ?? starts[side]) - starts[side]));
  }

  function setBothTimes(nextPosition: number) {
    const safe = Math.max(0, Math.min(duration, nextPosition));
    if (referenceAudio.current) referenceAudio.current.currentTime = starts.reference + safe;
    if (currentAudio.current) currentAudio.current.currentTime = starts.current + safe;
    setPosition(safe);
  }

  async function playSide(side: Side) {
    const audio = element(side);
    if (!audio) return;
    try {
      await audio.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  }

  async function togglePlay() {
    const audio = element(active);
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPosition(alignedPosition(active));
      setPlaying(false);
      return;
    }
    if (position >= duration - 0.02) setBothTimes(0);
    await playSide(active);
  }

  async function switchSide(next: Side) {
    if (next === active) return;
    const nextPosition = alignedPosition(active);
    const wasPlaying = playing;
    element(active)?.pause();
    setBothTimes(nextPosition);
    setActive(next);
    if (wasPlaying) await playSide(next);
  }

  useEffect(() => {
    return () => {
      URL.revokeObjectURL(referenceUrl);
      URL.revokeObjectURL(currentUrl);
    };
  }, [referenceUrl, currentUrl]);

  useEffect(() => {
    const target = Math.min(result.reference.rms_dbfs, result.current.rms_dbfs);
    if (referenceAudio.current) {
      referenceAudio.current.volume = levelMatched
        ? volumeFor(result.reference.rms_dbfs, target)
        : 1;
    }
    if (currentAudio.current) {
      currentAudio.current.volume = levelMatched
        ? volumeFor(result.current.rms_dbfs, target)
        : 1;
    }
  }, [levelMatched, result.reference.rms_dbfs, result.current.rms_dbfs]);

  useEffect(() => {
    setActive("reference");
    setPlaying(false);
    setBothTimes(0);
  }, [referenceUrl, currentUrl, offset]);

  return (
    <section className="ab-audition" aria-labelledby="ab-title">
      <div className="ab-heading">
        <div>
          <p className="eyebrow">A/B AUDITION / 聴き比べ</p>
          <h2 id="ab-title">同じ位置で切り替えて確認</h2>
          <p>位置合わせ結果を使い、再生位置を保ったまま参考音と自分の音を切り替えます。</p>
        </div>
        <label className="level-match-toggle">
          <input
            type="checkbox"
            checked={levelMatched}
            onChange={(event) => setLevelMatched(event.target.checked)}
          />
          音量を自動で揃える
        </label>
      </div>

      <audio
        ref={referenceAudio}
        src={referenceUrl}
        preload="metadata"
        onTimeUpdate={() => {
          if (active === "reference") setPosition(alignedPosition("reference"));
        }}
        onEnded={() => { setPlaying(false); setPosition(duration); }}
      />
      <audio
        ref={currentAudio}
        src={currentUrl}
        preload="metadata"
        onTimeUpdate={() => {
          if (active === "current") setPosition(alignedPosition("current"));
        }}
        onEnded={() => { setPlaying(false); setPosition(duration); }}
      />

      <div className="ab-switch" role="group" aria-label="再生する音源">
        <button
          type="button"
          className={active === "reference" ? "active" : ""}
          aria-pressed={active === "reference"}
          onClick={() => void switchSide("reference")}
        >
          A 参考音
        </button>
        <button
          type="button"
          className={active === "current" ? "active" : ""}
          aria-pressed={active === "current"}
          onClick={() => void switchSide("current")}
        >
          B 自分の音
        </button>
      </div>

      <div className="ab-transport">
        <button type="button" className="ab-play" onClick={() => void togglePlay()}>
          {playing ? "一時停止" : "再生"}
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(duration, 0.1)}
          step={0.01}
          value={Math.min(position, duration)}
          aria-label="再生位置"
          onChange={(event) => setBothTimes(Number(event.target.value))}
        />
        <span>{formatTime(position)} / {formatTime(duration)}</span>
      </div>
    </section>
  );
}
