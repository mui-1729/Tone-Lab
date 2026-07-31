"use client";

import { useMemo, useState } from "react";
import {
  evaluationsCsv,
  parseEvaluation,
  summarizeEvaluations,
} from "@/lib/evaluation-summary";
import type { EvaluationRecord } from "@/lib/evaluation-summary";

function percent(value: number | null) {
  return value === null ? "—" : `${(value * 100).toFixed(0)}%`;
}

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function EvaluationDashboard() {
  const [records, setRecords] = useState<EvaluationRecord[]>([]);
  const [failures, setFailures] = useState<string[]>([]);
  const summary = useMemo(() => summarizeEvaluations(records), [records]);
  const progress = Math.min(100, (summary.record_count / summary.target_count) * 100);

  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    const nextRecords: EvaluationRecord[] = [];
    const nextFailures: string[] = [];
    for (const file of Array.from(files)) {
      try {
        const value = JSON.parse(await file.text()) as unknown;
        nextRecords.push(parseEvaluation(value, file.name));
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "読み込みに失敗しました。";
        nextFailures.push(`${file.name}: ${message}`);
      }
    }
    setRecords((previous) => {
      const merged = new Map(previous.map((record) => [record.id, record]));
      for (const record of nextRecords) merged.set(record.id, record);
      return [...merged.values()].sort((left, right) => left.evaluated_at.localeCompare(right.evaluated_at));
    });
    setFailures(nextFailures);
  }

  function removeRecord(id: string) {
    setRecords((previous) => previous.filter((record) => record.id !== id));
  }

  function exportSummary() {
    download(
      "tone-lab-evaluation-summary.json",
      JSON.stringify({
        schema_version: 1,
        exported_at: new Date().toISOString(),
        summary,
        records,
      }, null, 2),
      "application/json;charset=utf-8",
    );
  }

  return (
    <details className="evaluation-dashboard">
      <summary>
        <span><strong>聴感評価ダッシュボード</strong><small>保存した評価JSONをまとめて精度を確認</small></span>
        <span>{summary.record_count} / {summary.target_count}件</span>
      </summary>
      <div className="dashboard-body">
        <div className="dashboard-intro">
          <div>
            <p className="eyebrow">VALIDATION / 評価集計</p>
            <h2>耳と判定の一致を集計する</h2>
            <p>評価JSONはこのブラウザ内でだけ読み込みます。集計データや音源をサーバーへ送信しません。</p>
          </div>
          <label className="dashboard-import">
            評価JSONを選ぶ
            <input type="file" accept="application/json,.json" multiple onChange={(event) => void importFiles(event.target.files)} />
          </label>
        </div>

        <div className="validation-progress" aria-label={`検証進捗 ${summary.record_count}/${summary.target_count}件`}>
          <span style={{ width: `${progress}%` }} />
        </div>
        <p className="validation-progress-label">目標20組まであと{Math.max(0, summary.target_count - summary.record_count)}組</p>

        {failures.length ? <ul className="dashboard-failures" role="alert">{failures.map((failure) => <li key={failure}>{failure}</li>)}</ul> : null}

        {records.length ? (
          <>
            <div className="dashboard-overview">
              <article><span>全体「はい」</span><strong>{summary.overall.agree}</strong></article>
              <article><span>全体「一部」</span><strong>{summary.overall.partial}</strong></article>
              <article><span>全体「いいえ」</span><strong>{summary.overall.disagree}</strong></article>
              <article><span>入力警告あり</span><strong>{summary.warning_record_count}</strong><small>品質情報あり {summary.quality_known_count}件</small></article>
              <article><span>低い位置一致</span><strong>{summary.low_alignment_count}</strong></article>
            </div>

            <section className="dashboard-section" aria-labelledby="axis-summary-title">
              <div><h3 id="axis-summary-title">5軸の方向一致率</h3><p>一致率の分母は「合っている＋違う」です。「わからない」と未評価は別表示します。</p></div>
              <div className="axis-summary-grid">
                {summary.axes.map((axis) => (
                  <article key={axis.key}>
                    <div><span>{axis.label}</span><strong>{percent(axis.agreement_rate)}</strong></div>
                    <div className="axis-agreement-meter"><span style={{ width: `${(axis.agreement_rate ?? 0) * 100}%` }} /></div>
                    <small>合う {axis.agree} / 違う {axis.disagree} / 不明 {axis.unsure} / 未評価 {axis.unrated}</small>
                  </article>
                ))}
              </div>
            </section>

            <section className="dashboard-section" aria-labelledby="bucket-title">
              <div><h3 id="bucket-title">予測した差の大きさ別</h3><p>大きい差ほど人間が安定して判断できているかを確認します。</p></div>
              <div className="bucket-grid">
                {summary.buckets.map((bucket) => (
                  <article key={bucket.key}>
                    <span>{bucket.label}</span>
                    <strong>{percent(bucket.agreement_rate)}</strong>
                    <small>合う {bucket.agree} / 違う {bucket.disagree} / 不明 {bucket.unsure}</small>
                  </article>
                ))}
              </div>
            </section>

            <section className="dashboard-section" aria-labelledby="problem-title">
              <div><h3 id="problem-title">確認が必要な比較</h3><p>方向不一致、全体「いいえ」、低い位置一致、入力警告を含む記録です。</p></div>
              {summary.problems.length ? <div className="problem-list">{summary.problems.map((problem) => (
                <article key={problem.record_id}>
                  <div><strong>{problem.files.reference} vs {problem.files.current}</strong><small>{problem.source_name}</small></div>
                  <ul>{problem.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
                </article>
              ))}</div> : <p className="problem-empty">現在の読み込みデータには、確認が必要な記録はありません。</p>}
            </section>

            <section className="dashboard-section" aria-labelledby="loaded-title">
              <div><h3 id="loaded-title">読み込み済み評価</h3><p>重複する同一評価は1件として扱います。</p></div>
              <div className="loaded-evaluations">{records.map((record) => (
                <article key={record.id}>
                  <div><strong>{record.files.reference} vs {record.files.current}</strong><small>{record.source_name} / {new Date(record.evaluated_at).toLocaleString("ja-JP")}</small></div>
                  <button type="button" onClick={() => removeRecord(record.id)}>除外</button>
                </article>
              ))}</div>
            </section>

            <div className="dashboard-actions">
              <button type="button" onClick={exportSummary}>集計JSONを保存</button>
              <button type="button" onClick={() => download("tone-lab-evaluations.csv", evaluationsCsv(records), "text/csv;charset=utf-8")}>CSVを保存</button>
              <button type="button" className="dashboard-clear" onClick={() => { setRecords([]); setFailures([]); }}>読み込みを解除</button>
            </div>
          </>
        ) : <p className="dashboard-empty">Tone Labで保存した聴感評価JSONを複数選択すると、ここに集計結果が表示されます。</p>}
      </div>
    </details>
  );
}
