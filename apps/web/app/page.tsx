"use client";

import { FormEvent, useState } from "react";
import { ABAudition } from "@/app/ab-audition";
import { AudioInput } from "@/app/audio-input";
import { EvaluationSection } from "@/app/evaluation";
import { ReferenceRangeSelector } from "@/app/reference-range";
import { ResultActions } from "@/app/result-actions";
import { SessionHistory } from "@/app/session-history";
import { SessionLibrary } from "@/app/session-library";
import { sliceAudioFile } from "@/lib/audio-file";
import { compareAudio } from "@/lib/api";
import { createId, updateSessionTakeNote } from "@/lib/session";
import type { SessionTake, ToneSession } from "@/lib/session";
import { saveSession } from "@/lib/session-storage";
import type {
  AdjustmentStep,
  AlignmentInfo,
  AudioSelection,
  CompareResponse,
  ComparisonVisuals,
  QualityInfo,
  ToneDimension,
} from "@/lib/types";

const CHART_WIDTH = 640;
const CHART_HEIGHT = 190;

function directionLabel(value: number) {
  if (Math.abs(value) < 8) return "かなり近い";
  return value > 0 ? "自分の音が強い" : "参考音が強い";
}

function selectionMatches(left: AudioSelection | null, right: AudioSelection | null) {
  if (!left || !right) return left === right;
  return Math.abs(left.start_seconds - right.start_seconds) < 0.001
    && Math.abs(left.end_seconds - right.end_seconds) < 0.001;
}

function fileMatches(left: File, right: File) {
  return left.name === right.name && left.size === right.size && left.lastModified === right.lastModified;
}

function defaultSessionName(filename: string) {
  return filename.replace(/\.[^.]+$/, "").slice(0, 80) || "Tone Lab セッション";
}

function AlignmentStatus({ alignment }: { alignment: AlignmentInfo }) {
  const absoluteOffset = Math.abs(alignment.offset_seconds);
  const adjustment = absoluteOffset < 0.02
    ? "開始位置の補正はほぼ不要でした。"
    : alignment.offset_seconds > 0
      ? `自分の音を約${absoluteOffset.toFixed(2)}秒前へ補正しました。`
      : `参考音を約${absoluteOffset.toFixed(2)}秒前へ補正しました。`;
  return (
    <section className={`alignment-card${alignment.warning ? " alignment-card-warning" : ""}`}>
      <div><p className="eyebrow">ALIGNMENT / 位置合わせ</p><p className="alignment-message">{adjustment}</p></div>
      <p className="alignment-meta">一致度 {(alignment.confidence * 100).toFixed(0)}% / 比較区間 {alignment.overlap_seconds.toFixed(1)}秒</p>
      {alignment.warning ? <p className="alignment-warning" role="alert">{alignment.warning}</p> : null}
    </section>
  );
}

function QualityStatus({ quality }: { quality: QualityInfo }) {
  const groups = [["参考音", quality.reference.warnings], ["自分の音", quality.current.warnings], ["比較条件", quality.comparison_warnings]] as const;
  const warnings = groups.flatMap(([label, items]) => items.map((item) => `${label}: ${item}`));
  return (
    <section className={`quality-card${warnings.length ? " quality-card-warning" : ""}`}>
      <div><p className="eyebrow">INPUT CHECK / 入力状態</p><p className="quality-message">{warnings.length ? "解析前に確認したい項目があります。" : "入力状態に大きな問題はありません。"}</p></div>
      <p className="quality-meta">クリップ候補 参考 {quality.reference.clipped_sample_percent.toFixed(3)}% / 自分 {quality.current.clipped_sample_percent.toFixed(3)}%</p>
      {warnings.length ? <ul className="quality-warnings" role="alert">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
    </section>
  );
}

function AdjustmentPlanSection({ steps }: { steps: AdjustmentStep[] }) {
  return (
    <section className="adjustment-section" aria-labelledby="adjustment-title">
      <div className="section-heading compact-heading"><p className="eyebrow">NEXT MOVES / 次に触るところ</p><h2 id="adjustment-title">優先調整プラン</h2><p>上から1項目ずつ変更し、毎回もう一度比較します。</p></div>
      {steps.length ? <div className="adjustment-grid">{steps.map((step, index) => (
        <article className="adjustment-card" key={step.key}>
          <div className="adjustment-priority">PRIORITY {index + 1}</div>
          <div className="adjustment-heading"><div><p>{step.label} / 差 {Math.abs(step.difference).toFixed(0)}</p><h3>{step.title}</h3></div><strong>{step.difference > 0 ? "+" : ""}{step.difference.toFixed(0)}</strong></div>
          <ol>{step.actions.map((action) => <li key={action}>{action}</li>)}</ol>
          <p className="adjustment-verify">{step.verify}</p>
        </article>
      ))}</div> : <div className="adjustment-empty">5つの質感軸では大きな調整は不要です。音量を揃えてA/Bし、耳で最終確認してください。</div>}
    </section>
  );
}

function chartPoints(values: number[], min: number, max: number) {
  const range = Math.max(max - min, Number.EPSILON);
  return values.map((value, index) => {
    const x = (index / Math.max(values.length - 1, 1)) * CHART_WIDTH;
    const normalized = Math.max(0, Math.min(1, (value - min) / range));
    return `${x.toFixed(1)},${(CHART_HEIGHT - normalized * CHART_HEIGHT).toFixed(1)}`;
  }).join(" ");
}

function ComparisonChart({ title, description, reference, current, min, max, leftLabel, rightLabel }: {
  title: string;
  description: string;
  reference: number[];
  current: number[];
  min: number;
  max: number;
  leftLabel: string;
  rightLabel: string;
}) {
  return (
    <article className="visual-card">
      <div className="visual-heading"><div><h3>{title}</h3><p>{description}</p></div><div className="chart-legend" aria-label="グラフの凡例"><span className="legend-reference">参考音</span><span className="legend-current">自分の音</span></div></div>
      <svg className="comparison-chart" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img" aria-label={`${title}の参考音と自分の音の比較`}>
        {[0.25, 0.5, 0.75].map((position) => <line key={position} className="chart-grid" x1="0" x2={CHART_WIDTH} y1={CHART_HEIGHT * position} y2={CHART_HEIGHT * position} />)}
        <polyline className="chart-line chart-reference" points={chartPoints(reference, min, max)} />
        <polyline className="chart-line chart-current" points={chartPoints(current, min, max)} />
      </svg>
      <div className="chart-axis" aria-hidden="true"><span>{leftLabel}</span><span>{rightLabel}</span></div>
    </article>
  );
}

function ComparisonVisualsSection({ visuals }: { visuals: ComparisonVisuals }) {
  const spectrum = visuals.spectrum;
  return (
    <section className="visuals-section" aria-labelledby="visuals-title">
      <div className="section-heading"><p className="eyebrow">VISUAL EVIDENCE / 視覚的な根拠</p><h2 id="visuals-title">波形と周波数の違い</h2></div>
      <div className="visual-grid">
        <ComparisonChart title="音量エンベロープ" description="時間ごとの音量変化。アタックと圧縮感の判断材料です。" reference={visuals.waveform.reference} current={visuals.waveform.current} min={0} max={1} leftLabel="0秒" rightLabel={`${visuals.waveform.duration_seconds.toFixed(1)}秒`} />
        <ComparisonChart title="平均周波数分布" description="低域から高域までの強さ。明るさ・太さ・粗さの判断材料です。" reference={spectrum.reference_db} current={spectrum.current_db} min={-60} max={0} leftLabel={`${spectrum.frequencies_hz[0]?.toFixed(0) ?? "80"}Hz`} rightLabel={`${(spectrum.frequencies_hz.at(-1) ?? 12_000) / 1_000}kHz`} />
      </div>
    </section>
  );
}

function DimensionCard({ dimension }: { dimension: ToneDimension }) {
  const magnitude = Math.min(100, Math.abs(dimension.difference));
  const left = dimension.difference < 0 ? 50 - magnitude / 2 : 50;
  return (
    <article className="dimension-card">
      <div className="dimension-heading"><div><h3>{dimension.label}</h3><p>{directionLabel(dimension.difference)}</p></div><strong>{dimension.difference > 0 ? "+" : ""}{dimension.difference.toFixed(0)}</strong></div>
      <div className="scale" aria-label={`${dimension.label}の差 ${dimension.difference.toFixed(0)}`}><span className="scale-center" /><span className="scale-fill" style={{ left: `${left}%`, width: `${magnitude / 2}%` }} /></div>
      <p className="interpretation">{dimension.interpretation}</p>
      <ul>{dimension.evidence.map((item) => <li key={item}>{item}</li>)}</ul>
      <p className="suggestion"><span>調整方向</span>{dimension.suggestion}</p>
    </article>
  );
}

export default function Home() {
  const [reference, setReference] = useState<File | null>(null);
  const [current, setCurrent] = useState<File | null>(null);
  const [referenceSelection, setReferenceSelection] = useState<AudioSelection | null>(null);
  const [analyzedReference, setAnalyzedReference] = useState<File | null>(null);
  const [result, setResult] = useState<CompareResponse | null>(null);
  const [session, setSession] = useState<ToneSession | null>(null);
  const [libraryRevision, setLibraryRevision] = useState(0);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function persist(nextSession: ToneSession) {
    setSession(nextSession);
    try {
      await saveSession(nextSession);
      setLibraryRevision((value) => value + 1);
      setStorageWarning(null);
    } catch {
      setStorageWarning("比較は完了しましたが、端末内ライブラリへ保存できませんでした。ブラウザの空き容量と保存設定を確認してください。");
    }
  }

  function clearActiveResult() {
    setCurrent(null);
    setAnalyzedReference(null);
    setResult(null);
    setError(null);
  }

  function changeReference(file: File | null) {
    setReference(file);
    setReferenceSelection(null);
    setAnalyzedReference(null);
    setCurrent(null);
    setResult(null);
    setSession(null);
    setStorageWarning(null);
  }

  function changeCurrent(file: File | null) {
    setCurrent(file);
    setAnalyzedReference(null);
    setResult(null);
  }

  function changeReferenceSelection(selection: AudioSelection | null) {
    setReferenceSelection(selection);
    setAnalyzedReference(null);
    setCurrent(null);
    setResult(null);
    setSession(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reference || !current) {
      setError("参考音と自分の音を両方選択または録音してください。");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const preparedReference = referenceSelection ? await sliceAudioFile(reference, referenceSelection) : reference;
      const response = await compareAudio(preparedReference, current);
      const now = new Date().toISOString();
      const take: SessionTake = {
        id: createId("take"),
        created_at: now,
        current_file: current,
        result: response,
        note: "",
      };
      const canAppend = session
        && fileMatches(session.reference_file, reference)
        && selectionMatches(session.reference_selection, referenceSelection);
      const nextSession: ToneSession = canAppend ? {
        ...session,
        analyzed_reference_file: preparedReference,
        updated_at: now,
        takes: [...session.takes, take],
      } : {
        schema_version: 1,
        id: createId("session"),
        name: defaultSessionName(reference.name),
        created_at: now,
        updated_at: now,
        reference_file: reference,
        analyzed_reference_file: preparedReference,
        reference_selection: referenceSelection,
        takes: [take],
        blind_trials: [],
      };
      setAnalyzedReference(preparedReference);
      setResult(response);
      await persist(nextSession);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "区間の切り出しまたは解析に失敗しました。");
    } finally {
      setLoading(false);
    }
  }

  function loadSavedSession(saved: ToneSession) {
    const latest = saved.takes.at(-1) ?? null;
    setSession(saved);
    setReference(saved.reference_file);
    setReferenceSelection(saved.reference_selection);
    setAnalyzedReference(latest ? saved.analyzed_reference_file : null);
    setCurrent(latest?.current_file ?? null);
    setResult(latest?.result ?? null);
    setError(null);
    setStorageWarning(null);
    window.setTimeout(() => document.getElementById("comparison-results")?.scrollIntoView({ behavior: "smooth" }), 0);
  }

  function reset() {
    setReference(null);
    setCurrent(null);
    setReferenceSelection(null);
    setAnalyzedReference(null);
    setResult(null);
    setSession(null);
    setError(null);
    setStorageWarning(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function nextTake() {
    clearActiveResult();
    window.setTimeout(() => document.getElementById("comparison-workspace")?.scrollIntoView({ behavior: "smooth" }), 0);
  }

  function renameActiveSession(name: string) {
    if (!session) return;
    void persist({ ...session, name, updated_at: new Date().toISOString() });
  }

  function updateActiveTakeNote(takeId: string, note: string) {
    if (!session) return;
    void persist(updateSessionTakeNote(session, takeId, note));
  }

  const recordingLimit = referenceSelection ? referenceSelection.end_seconds - referenceSelection.start_seconds : 30;

  return (
    <main>
      <header className="hero">
        <p className="brand">TONE LAB / 2.0</p>
        <h1>音の違いを、<br />調整できる言葉にする。</h1>
        <p className="lead">参考音を固定し、録音・比較・調整を繰り返した進捗を端末内に保存できます。</p>
      </header>

      <SessionLibrary revision={libraryRevision} activeSessionId={session?.id ?? null} onLoad={loadSavedSession} onActiveDeleted={reset} />

      <form id="comparison-workspace" className="workspace" onSubmit={handleSubmit}>
        <div className="upload-grid">
          <AudioInput id="reference" label="REFERENCE / 参考音" file={reference} onChange={changeReference} />
          <AudioInput id="current" label="CURRENT / 自分の音" file={current} onChange={changeCurrent} recordingLimitSeconds={recordingLimit} />
        </div>
        {reference ? <ReferenceRangeSelector key={`${reference.name}-${reference.lastModified}`} file={reference} selection={referenceSelection} onChange={changeReferenceSelection} /> : null}
        <div className="conditions"><span>調整履歴を自動保存</span><span>比較区間を選択可能</span><span>ファイルまたは直接録音</span><span>最大30秒</span></div>
        <p className="privacy-note">音源と履歴はこのブラウザの端末内へ保存できます。解析時以外にサーバーへ音源を保存せず、他の端末とは同期しません。</p>
        <button className="analyze-button" type="submit" disabled={loading}>{loading ? "解析中…" : session?.takes.length ? "次のテイクを比較する" : "2つの音を比較する"}</button>
        {error ? <p className="error" role="alert">{error}</p> : null}
        {storageWarning ? <p className="session-storage-warning" role="alert">{storageWarning}</p> : null}
      </form>

      {result && analyzedReference && reference && current ? (
        <section id="comparison-results" className="results">
          <div className="result-title"><p className="eyebrow">COMPARISON</p><h2>主な違い</h2></div>
          <AlignmentStatus alignment={result.alignment} />
          <QualityStatus quality={result.quality} />
          <ABAudition referenceFile={analyzedReference} currentFile={current} result={result} />
          <div className="summary-grid">{result.summary.map((item) => <p key={item}>{item}</p>)}</div>
          <AdjustmentPlanSection steps={result.adjustment_plan} />
          {session ? <SessionHistory session={session} onNextTake={nextTake} onRename={renameActiveSession} onUpdateNote={updateActiveTakeNote} /> : null}
          <div className="legend"><span>− 参考音が強い</span><span>0 近い</span><span>＋ 自分の音が強い</span></div>
          <div className="dimension-grid">{result.dimensions.map((dimension) => <DimensionCard key={dimension.key} dimension={dimension} />)}</div>
          <ComparisonVisualsSection visuals={result.visuals} />
          <EvaluationSection result={result} referenceName={reference.name} currentName={current.name} referenceSelection={referenceSelection} />
          <details className="raw-data"><summary>測定値を見る</summary><pre>{JSON.stringify({ reference_selection: referenceSelection, alignment: result.alignment, quality: result.quality, reference: result.reference, current: result.current }, null, 2)}</pre></details>
          <p className="disclaimer">{result.disclaimer}</p>
          <ResultActions result={result} referenceName={reference.name} currentName={current.name} referenceSelection={referenceSelection} onReset={reset} />
        </section>
      ) : null}
    </main>
  );
}
