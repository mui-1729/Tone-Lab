"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { compareAudio } from "@/lib/api";
import type { CompareResponse, ToneDimension } from "@/lib/types";

const ACCEPT = ".wav,.mp3,.flac,.ogg,audio/wav,audio/mpeg,audio/flac,audio/ogg";

function AudioInput({
  id,
  label,
  file,
  onChange,
}: {
  id: string;
  label: string;
  file: File | null;
  onChange: (file: File | null) => void;
}) {
  const previewUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  return (
    <section className="audio-card">
      <div>
        <p className="eyebrow">{label}</p>
        <p className="file-name">{file?.name ?? "音源を選択してください"}</p>
      </div>
      <label className="file-button" htmlFor={id}>
        ファイルを選ぶ
      </label>
      <input
        id={id}
        className="sr-only"
        type="file"
        accept={ACCEPT}
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />
      {previewUrl ? <audio className="audio-player" controls src={previewUrl} /> : null}
    </section>
  );
}

function directionLabel(value: number) {
  if (Math.abs(value) < 8) return "かなり近い";
  return value > 0 ? "自分の音が強い" : "参考音が強い";
}

function DimensionCard({ dimension }: { dimension: ToneDimension }) {
  const magnitude = Math.min(100, Math.abs(dimension.difference));
  const left = dimension.difference < 0 ? 50 - magnitude / 2 : 50;

  return (
    <article className="dimension-card">
      <div className="dimension-heading">
        <div>
          <h3>{dimension.label}</h3>
          <p>{directionLabel(dimension.difference)}</p>
        </div>
        <strong>{dimension.difference > 0 ? "+" : ""}{dimension.difference.toFixed(0)}</strong>
      </div>
      <div className="scale" aria-label={`${dimension.label}の差 ${dimension.difference.toFixed(0)}`}>
        <span className="scale-center" />
        <span className="scale-fill" style={{ left: `${left}%`, width: `${magnitude / 2}%` }} />
      </div>
      <p className="interpretation">{dimension.interpretation}</p>
      <ul>
        {dimension.evidence.map((item) => <li key={item}>{item}</li>)}
      </ul>
      <p className="suggestion"><span>調整方向</span>{dimension.suggestion}</p>
    </article>
  );
}

export default function Home() {
  const [reference, setReference] = useState<File | null>(null);
  const [current, setCurrent] = useState<File | null>(null);
  const [result, setResult] = useState<CompareResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reference || !current) {
      setError("参考音と自分の音を両方選択してください。");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await compareAudio(reference, current));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "解析に失敗しました。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main>
      <header className="hero">
        <p className="brand">TONE LAB / PROTOTYPE 0.1</p>
        <h1>音の違いを、<br />調整できる言葉にする。</h1>
        <p className="lead">
          参考音と自分のギター音を比較し、明るさ・太さ・アタック・圧縮感・粗さの差を表示します。
        </p>
      </header>

      <form className="workspace" onSubmit={handleSubmit}>
        <div className="upload-grid">
          <AudioInput id="reference" label="REFERENCE / 参考音" file={reference} onChange={setReference} />
          <AudioInput id="current" label="CURRENT / 自分の音" file={current} onChange={setCurrent} />
        </div>
        <div className="conditions">
          <span>同じフレーズ推奨</span>
          <span>最大30秒</span>
          <span>WAV / MP3 / FLAC / OGG</span>
        </div>
        <button className="analyze-button" type="submit" disabled={loading}>
          {loading ? "解析中…" : "2つの音を比較する"}
        </button>
        {error ? <p className="error" role="alert">{error}</p> : null}
      </form>

      {result ? (
        <section className="results">
          <div className="result-title">
            <p className="eyebrow">COMPARISON</p>
            <h2>主な違い</h2>
          </div>
          <div className="summary-grid">
            {result.summary.map((item) => <p key={item}>{item}</p>)}
          </div>
          <div className="legend">
            <span>− 参考音が強い</span>
            <span>0 近い</span>
            <span>＋ 自分の音が強い</span>
          </div>
          <div className="dimension-grid">
            {result.dimensions.map((dimension) => (
              <DimensionCard key={dimension.key} dimension={dimension} />
            ))}
          </div>
          <details className="raw-data">
            <summary>測定値を見る</summary>
            <pre>{JSON.stringify({ reference: result.reference, current: result.current }, null, 2)}</pre>
          </details>
          <p className="disclaimer">{result.disclaimer}</p>
        </section>
      ) : null}
    </main>
  );
}
