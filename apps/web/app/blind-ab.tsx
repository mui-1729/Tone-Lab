"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { answerForChoice, createBlindAssignment } from "@/lib/blind";
import type { BlindChoice } from "@/lib/blind";
import { createId } from "@/lib/session";
import type { BlindTrial, SessionTake, ToneSession } from "@/lib/session";

type Source = "reference" | "x" | "y";

function formatTime(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
}

function volumeFor(rmsDbfs: number, targetDbfs: number) {
  return Math.max(0, Math.min(1, 10 ** ((targetDbfs - rmsDbfs) / 20)));
}

function alignmentStarts(take: SessionTake) {
  const offset = take.result.alignment.offset_seconds;
  return {
    reference: offset < 0 ? -offset : 0,
    current: offset > 0 ? offset : 0,
  };
}

export function BlindAB({
  session,
  onComplete,
}: {
  session: ToneSession;
  onComplete: (trial: BlindTrial) => void;
}) {
  const earlier = session.takes.at(-2);
  const later = session.takes.at(-1);
  if (!earlier || !later) return null;

  return <BlindABPlayer key={`${earlier.id}-${later.id}`} session={session} earlier={earlier} later={later} onComplete={onComplete} />;
}

function BlindABPlayer({
  session,
  earlier,
  later,
  onComplete,
}: {
  session: ToneSession;
  earlier: SessionTake;
  later: SessionTake;
  onComplete: (trial: BlindTrial) => void;
}) {
  const [assignment, setAssignment] = useState(() => createBlindAssignment(earlier.id, later.id));
  const [active, setActive] = useState<Source>("reference");
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [levelMatched, setLevelMatched] = useState(true);
  const [answer, setAnswer] = useState<BlindChoice | null>(null);

  const xTake = assignment.x_take_id === earlier.id ? earlier : later;
  const yTake = assignment.y_take_id === earlier.id ? earlier : later;
  const xStarts = alignmentStarts(xTake);
  const yStarts = alignmentStarts(yTake);
  const referenceStart = Math.max(xStarts.reference, yStarts.reference);
  const starts: Record<Source, number> = {
    reference: referenceStart,
    x: xStarts.current + referenceStart - xStarts.reference,
    y: yStarts.current + referenceStart - yStarts.reference,
  };
  const rawDuration = Math.min(
    xTake.result.alignment.overlap_seconds - (referenceStart - xStarts.reference),
    yTake.result.alignment.overlap_seconds - (referenceStart - yStarts.reference),
  );
  const duration = Math.max(0, rawDuration);

  const referenceUrl = useMemo(() => URL.createObjectURL(session.analyzed_reference_file), [session.analyzed_reference_file]);
  const xUrl = useMemo(() => URL.createObjectURL(xTake.current_file), [xTake.current_file]);
  const yUrl = useMemo(() => URL.createObjectURL(yTake.current_file), [yTake.current_file]);
  const referenceAudio = useRef<HTMLAudioElement>(null);
  const xAudio = useRef<HTMLAudioElement>(null);
  const yAudio = useRef<HTMLAudioElement>(null);

  function element(source: Source) {
    if (source === "reference") return referenceAudio.current;
    return source === "x" ? xAudio.current : yAudio.current;
  }

  function commonPosition(source: Source) {
    const audio = element(source);
    return Math.max(0, Math.min(duration, (audio?.currentTime ?? starts[source]) - starts[source]));
  }

  function setAllTimes(nextPosition: number) {
    const safe = Math.max(0, Math.min(duration, nextPosition));
    if (referenceAudio.current) referenceAudio.current.currentTime = starts.reference + safe;
    if (xAudio.current) xAudio.current.currentTime = starts.x + safe;
    if (yAudio.current) yAudio.current.currentTime = starts.y + safe;
    setPosition(safe);
  }

  async function playSource(source: Source, nextPosition = position) {
    const audio = element(source);
    if (!audio) return;
    audio.currentTime = starts[source] + Math.min(nextPosition, duration);
    try {
      await audio.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  }

  async function togglePlay() {
    const audio = element(active);
    if (!audio || duration < 0.5) return;
    if (playing) {
      audio.pause();
      setPosition(commonPosition(active));
      setPlaying(false);
      return;
    }
    const nextPosition = position >= duration - 0.02 ? 0 : position;
    setAllTimes(nextPosition);
    await playSource(active, nextPosition);
  }

  async function switchSource(next: Source) {
    if (next === active || duration < 0.5) return;
    const nextPosition = commonPosition(active);
    const wasPlaying = playing;
    element(active)?.pause();
    setAllTimes(nextPosition);
    setActive(next);
    if (wasPlaying) await playSource(next, nextPosition);
  }

  function updatePosition(source: Source) {
    if (active !== source) return;
    const next = commonPosition(source);
    setPosition(next);
    if (next >= duration - 0.01) {
      element(source)?.pause();
      setPlaying(false);
    }
  }

  function submit(choice: BlindChoice) {
    if (answer) return;
    setAnswer(choice);
    onComplete({
      id: createId("blind"),
      created_at: new Date().toISOString(),
      earlier_take_id: earlier.id,
      later_take_id: later.id,
      answer: answerForChoice(choice, assignment, later.id),
      x_take_id: assignment.x_take_id,
      y_take_id: assignment.y_take_id,
    });
  }

  function retry() {
    referenceAudio.current?.pause();
    xAudio.current?.pause();
    yAudio.current?.pause();
    setAssignment(createBlindAssignment(earlier.id, later.id));
    setActive("reference");
    setPlaying(false);
    setPosition(0);
    setAnswer(null);
  }

  useEffect(() => () => {
    URL.revokeObjectURL(referenceUrl);
    URL.revokeObjectURL(xUrl);
    URL.revokeObjectURL(yUrl);
  }, [referenceUrl, xUrl, yUrl]);

  useEffect(() => {
    const referenceRms = (xTake.result.reference.rms_dbfs + yTake.result.reference.rms_dbfs) / 2;
    const target = Math.min(referenceRms, xTake.result.current.rms_dbfs, yTake.result.current.rms_dbfs);
    if (referenceAudio.current) referenceAudio.current.volume = levelMatched ? volumeFor(referenceRms, target) : 1;
    if (xAudio.current) xAudio.current.volume = levelMatched ? volumeFor(xTake.result.current.rms_dbfs, target) : 1;
    if (yAudio.current) yAudio.current.volume = levelMatched ? volumeFor(yTake.result.current.rms_dbfs, target) : 1;
  }, [levelMatched, xTake, yTake]);

  const revealedAnswer = answer ? answerForChoice(answer, assignment, later.id) : null;

  return (
    <section className="blind-ab" aria-labelledby="blind-title">
      <div className="blind-heading">
        <div>
          <p className="eyebrow">BLIND A/B / ブラインド確認</p>
          <h2 id="blind-title">調整前後を隠して聴く</h2>
          <p>参考音、X、Yを同じ位置と音量条件で切り替え、どちらが参考音に近いか回答します。</p>
        </div>
        <label><input type="checkbox" checked={levelMatched} onChange={(event) => setLevelMatched(event.target.checked)} />音量を自動で揃える</label>
      </div>

      {duration < 0.5 ? <p className="blind-warning">2テイクで共通して再生できる区間が短いため、ブラインド比較を実行できません。</p> : (
        <>
          <audio ref={referenceAudio} src={referenceUrl} preload="metadata" onTimeUpdate={() => updatePosition("reference")} onEnded={() => setPlaying(false)} />
          <audio ref={xAudio} src={xUrl} preload="metadata" onTimeUpdate={() => updatePosition("x")} onEnded={() => setPlaying(false)} />
          <audio ref={yAudio} src={yUrl} preload="metadata" onTimeUpdate={() => updatePosition("y")} onEnded={() => setPlaying(false)} />

          <div className="blind-source-switch" role="group" aria-label="ブラインド再生音源">
            {(["reference", "x", "y"] as Source[]).map((source) => (
              <button type="button" key={source} className={active === source ? "active" : ""} aria-pressed={active === source} onClick={() => void switchSource(source)}>
                {source === "reference" ? "参考音" : source.toUpperCase()}
              </button>
            ))}
          </div>

          <div className="blind-transport">
            <button type="button" onClick={() => void togglePlay()}>{playing ? "一時停止" : "再生"}</button>
            <input type="range" min={0} max={Math.max(duration, 0.1)} step={0.01} value={Math.min(position, duration)} aria-label="ブラインド試聴の再生位置" onChange={(event) => setAllTimes(Number(event.target.value))} />
            <span>{formatTime(position)} / {formatTime(duration)}</span>
          </div>

          <div className="blind-question">
            <strong>どちらが参考音に近い？</strong>
            <div role="group" aria-label="ブラインド評価">
              <button type="button" disabled={answer !== null} onClick={() => submit("x")}>X</button>
              <button type="button" disabled={answer !== null} onClick={() => submit("y")}>Y</button>
              <button type="button" disabled={answer !== null} onClick={() => submit("unsure")}>判断できない</button>
            </div>
          </div>

          {answer ? (
            <div className="blind-reveal" role="status">
              <strong>{revealedAnswer === "later" ? "調整後を参考音に近いと判断しました。" : revealedAnswer === "earlier" ? "調整前を参考音に近いと判断しました。" : "差を判断できないと記録しました。"}</strong>
              <p>Xは{assignment.x_take_id === later.id ? "調整後" : "調整前"}、Yは{assignment.y_take_id === later.id ? "調整後" : "調整前"}でした。</p>
              <button type="button" onClick={retry}>割り当てを変えて再試行</button>
            </div>
          ) : null}
        </>
      )}
      <p className="blind-count">このセッションの記録済みブラインド回答: {session.blind_trials.length}件</p>
    </section>
  );
}
