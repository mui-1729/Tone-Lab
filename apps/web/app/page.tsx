"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { ABAudition } from "@/app/ab-audition";
import { EvaluationSection } from "@/app/evaluation";
import { ResultActions } from "@/app/result-actions";
import { compareAudio } from "@/lib/api";
import type { AdjustmentStep, AlignmentInfo, CompareResponse, ComparisonVisuals, QualityInfo, ToneDimension } from "@/lib/types";

const ACCEPT = ".wav,.mp3,.flac,.ogg,audio/wav,audio/mpeg,audio/flac,audio/ogg";
const CHART_WIDTH = 640;
const CHART_HEIGHT = 190;

function AudioInput({ id, label, file, onChange }: { id: string; label: string; file: File | null; onChange: (file: File | null) => void; }) {
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  return <section className="audio-card"><div><p className="eyebrow">{label}</p><p className="file-name">{file?.name ?? "音源を選択してください"}</p></div><label className="file-button" htmlFor={id}>ファイルを選ぶ</label><input key={file ? `${file.name}-${file.lastModified}` : "empty"} id={id} className="sr-only" type="file" accept={ACCEPT} onChange={(event) => onChange(event.target.files?.[0] ?? null)} />{previewUrl ? <audio className="audio-player" controls src={previewUrl} /> : null}</section>;
}

function directionLabel(value: number) { if (Math.abs(value) < 8) return "かなり近い"; return value > 0 ? "自分の音が強い" : "参考音が強い"; }

function AlignmentStatus({ alignment }: { alignment: AlignmentInfo }) {
  const absoluteOffset = Math.abs(alignment.offset_seconds);
  const adjustment = absoluteOffset < 0.02 ? "開始位置の補正はほぼ不要でした。" : alignment.offset_seconds > 0 ? `自分の音を約${absoluteOffset.toFixed(2)}秒前へ補正しました。` : `参考音を約${absoluteOffset.toFixed(2)}秒前へ補正しました。`;
  return <section className={`alignment-card${alignment.warning ? " alignment-card-warning" : ""}`}><div><p className="eyebrow">ALIGNMENT / 位置合わせ</p><p className="alignment-message">{adjustment}</p></div><p className="alignment-meta">一致度 {(alignment.confidence * 100).toFixed(0)}% / 比較区間 {alignment.overlap_seconds.toFixed(1)}秒</p>{alignment.warning ? <p className="alignment-warning" role="alert">{alignment.warning}</p> : null}</section>;
}

function QualityStatus({ quality }: { quality: QualityInfo }) {
  const groups = [["参考音", quality.reference.warnings], ["自分の音", quality.current.warnings], ["比較条件", quality.comparison_warnings]] as const;
  const warnings = groups.flatMap(([label, items]) => items.map((item) => `${label}: ${item}`));
  return <section className={`quality-card${warnings.length ? " quality-card-warning" : ""}`}><div><p className="eyebrow">INPUT CHECK / 入力状態</p><p className="quality-message">{warnings.length ? "解析前に確認したい項目があります。" : "入力状態に大きな問題はありません。"}</p></div><p className="quality-meta">クリップ候補 参考 {quality.reference.clipped_sample_percent.toFixed(3)}% / 自分 {quality.current.clipped_sample_percent.toFixed(3)}%</p>{warnings.length ? <ul className="quality-warnings" role="alert">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}</section>;
}

function AdjustmentPlanSection({ steps }: { steps: AdjustmentStep[] }) {
  return <section className="adjustment-section" aria-labelledby="adjustment-title"><div className="section-heading compact-heading"><p className="eyebrow">NEXT MOVES / 次に触るところ</p><h2 id="adjustment-title">優先調整プラン</h2><p>上から1項目ずつ変更し、毎回もう一度比較します。</p></div>{steps.length ? <div className="adjustment-grid">{steps.map((step, index) => <article className="adjustment-card" key={step.key}><div className="adjustment-priority">PRIORITY {index + 1}</div><div className="adjustment-heading"><div><p>{step.label} / 差 {Math.abs(step.difference).toFixed(0)}</p><h3>{step.title}</h3></div><strong>{step.difference > 0 ? "+" : ""}{step.difference.toFixed(0)}</strong></div><ol>{step.actions.map((action) => <li key={action}>{action}</li>)}</ol><p className="adjustment-verify">{step.verify}</p></article>)}</div> : <div className="adjustment-empty">5つの質感軸では大きな調整は不要です。音量を揃えてA/Bし、耳で最終確認してください。</div>}</section>;
}

function chartPoints(values: number[], min: number, max: number) { const range = Math.max(max - min, Number.EPSILON); return values.map((value, index) => { const x = (index / Math.max(values.length - 1, 1)) * CHART_WIDTH; const normalized = Math.max(0, Math.min(1, (value - min) / range)); return `${x.toFixed(1)},${(CHART_HEIGHT - normalized * CHART_HEIGHT).toFixed(1)}`; }).join(" "); }

function ComparisonChart({ title, description, reference, current, min, max, leftLabel, rightLabel }: { title: string; description: string; reference: number[]; current: number[]; min: number; max: number; leftLabel: string; rightLabel: string; }) {
  return <article className="visual-card"><div className="visual-heading"><div><h3>{title}</h3><p>{description}</p></div><div className="chart-legend" aria-label="グラフの凡例"><span className="legend-reference">参考音</span><span className="legend-current">自分の音</span></div></div><svg className="comparison-chart" viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img" aria-label={`${title}の参考音と自分の音の比較`}>{[0.25, 0.5, 0.75].map((position) => <line key={position} className="chart-grid" x1="0" x2={CHART_WIDTH} y1={CHART_HEIGHT * position} y2={CHART_HEIGHT * position} />)}<polyline className="chart-line chart-reference" points={chartPoints(reference, min, max)} /><polyline className="chart-line chart-current" points={chartPoints(current, min, max)} /></svg><div className="chart-axis" aria-hidden="true"><span>{leftLabel}</span><span>{rightLabel}</span></div></article>;
}

function ComparisonVisualsSection({ visuals }: { visuals: ComparisonVisuals }) { const spectrum = visuals.spectrum; return <section className="visuals-section" aria-labelledby="visuals-title"><div className="section-heading"><p className="eyebrow">VISUAL EVIDENCE / 視覚的な根拠</p><h2 id="visuals-title">波形と周波数の違い</h2></div><div className="visual-grid"><ComparisonChart title="音量エンベロープ" description="時間ごとの音量変化。アタックと圧縮感の判断材料です。" reference={visuals.waveform.reference} current={visuals.waveform.current} min={0} max={1} leftLabel="0秒" rightLabel={`${visuals.waveform.duration_seconds.toFixed(1)}秒`} /><ComparisonChart title="平均周波数分布" description="低域から高域までの強さ。明るさ・太さ・粗さの判断材料です。" reference={spectrum.reference_db} current={spectrum.current_db} min={-60} max={0} leftLabel={`${spectrum.frequencies_hz[0]?.toFixed(0) ?? "80"}Hz`} rightLabel={`${(spectrum.frequencies_hz.at(-1) ?? 12_000) / 1_000}kHz`} /></div></section>; }

function DimensionCard({ dimension }: { dimension: ToneDimension }) { const magnitude = Math.min(100, Math.abs(dimension.difference)); const left = dimension.difference < 0 ? 50 - magnitude / 2 : 50; return <article className="dimension-card"><div className="dimension-heading"><div><h3>{dimension.label}</h3><p>{directionLabel(dimension.difference)}</p></div><strong>{dimension.difference > 0 ? "+" : ""}{dimension.difference.toFixed(0)}</strong></div><div className="scale" aria-label={`${dimension.label}の差 ${dimension.difference.toFixed(0)}`}><span className="scale-center" /><span className="scale-fill" style={{ left: `${left}%`, width: `${magnitude / 2}%` }} /></div><p className="interpretation">{dimension.interpretation}</p><ul>{dimension.evidence.map((item) => <li key={item}>{item}</li>)}</ul><p className="suggestion"><span>調整方向</span>{dimension.suggestion}</p></article>; }

export default function Home() {
  const [reference, setReference] = useState<File | null>(null); const [current, setCurrent] = useState<File | null>(null); const [result, setResult] = useState<CompareResponse | null>(null); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(false);
  async function handleSubmit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!reference || !current) { setError("参考音と自分の音を両方選択してください。"); return; } setLoading(true); setError(null); setResult(null); try { setResult(await compareAudio(reference, current)); } catch (caught) { setError(caught instanceof Error ? caught.message : "解析に失敗しました。"); } finally { setLoading(false); } }
  function reset() { setReference(null); setCurrent(null); setResult(null); setError(null); window.scrollTo({ top: 0, behavior: "smooth" }); }
  return <main><header className="hero"><p className="brand">TONE LAB / PROTOTYPE 0.1</p><h1>音の違いを、<br />調整できる言葉にする。</h1><p className="lead">参考音と自分のギター音を比較し、明るさ・太さ・アタック・圧縮感・粗さの差を表示します。</p></header><form className="workspace" onSubmit={handleSubmit}><div className="upload-grid"><AudioInput id="reference" label="REFERENCE / 参考音" file={reference} onChange={setReference} /><AudioInput id="current" label="CURRENT / 自分の音" file={current} onChange={setCurrent} /></div><div className="conditions"><span>同じフレーズ推奨</span><span>開始位置を自動補正</span><span>最大30秒</span><span>WAV / MP3 / FLAC / OGG</span></div><button className="analyze-button" type="submit" disabled={loading}>{loading ? "解析中…" : "2つの音を比較する"}</button>{error ? <p className="error" role="alert">{error}</p> : null}</form>{result && reference && current ? <section className="results"><div className="result-title"><p className="eyebrow">COMPARISON</p><h2>主な違い</h2></div><AlignmentStatus alignment={result.alignment} /><QualityStatus quality={result.quality} /><ABAudition referenceFile={reference} currentFile={current} result={result} /><div className="summary-grid">{result.summary.map((item) => <p key={item}>{item}</p>)}</div><AdjustmentPlanSection steps={result.adjustment_plan} /><div className="legend"><span>− 参考音が強い</span><span>0 近い</span><span>＋ 自分の音が強い</span></div><div className="dimension-grid">{result.dimensions.map((dimension) => <DimensionCard key={dimension.key} dimension={dimension} />)}</div><ComparisonVisualsSection visuals={result.visuals} /><EvaluationSection result={result} referenceName={reference.name} currentName={current.name} /><details className="raw-data"><summary>測定値を見る</summary><pre>{JSON.stringify({ alignment: result.alignment, quality: result.quality, reference: result.reference, current: result.current }, null, 2)}</pre></details><p className="disclaimer">{result.disclaimer}</p><ResultActions result={result} referenceName={reference.name} currentName={current.name} onReset={reset} /></section> : null}</main>;
}
