"use client";

import { aggregateToneResults } from "@/lib/aggregate";
import type { ConfidenceLevel } from "@/lib/aggregate";
import type { ToneSession } from "@/lib/session";
import { sessionMarkdown, sessionPayload, toneDistance } from "@/lib/session";

type ChangeKind = "start" | "improved" | "maintained" | "worsened";

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

function safeStem(value: string) {
  return value.replace(/[^a-zA-Z0-9ぁ-んァ-ヶ一-龠_-]+/g, "-").slice(0, 48) || "session";
}

function changeKind(current: number, previous: number | null): ChangeKind {
  if (previous === null) return "start";
  const delta = Math.abs(current) - Math.abs(previous);
  if (delta <= -2) return "improved";
  if (delta >= 2) return "worsened";
  return "maintained";
}

function changeLabel(kind: ChangeKind) {
  return { start: "開始", improved: "改善", maintained: "維持", worsened: "悪化" }[kind];
}

function confidenceLabel(level: ConfidenceLevel) {
  return { high: "高", medium: "中", low: "低" }[level];
}

function distanceLabel(current: number, previous: number | null) {
  if (previous === null) return "最初のテイク";
  const delta = current - previous;
  if (delta <= -3) return `前回より${Math.abs(delta).toFixed(1)}改善`;
  if (delta >= 3) return `前回より${delta.toFixed(1)}増加`;
  return "前回とほぼ同じ";
}

export function SessionHistory({
  session,
  onNextTake,
  onRename,
  onUpdateNote,
}: {
  session: ToneSession;
  onNextTake: () => void;
  onRename: (name: string) => void;
  onUpdateNote: (takeId: string, note: string) => void;
}) {
  const latest = session.takes.at(-1);
  if (!latest) return null;
  const previous = session.takes.at(-2) ?? null;
  const latestDistance = toneDistance(latest.result);
  const previousDistance = previous ? toneDistance(previous.result) : null;
  const previousByKey = new Map(previous?.result.dimensions.map((dimension) => [dimension.key, dimension]) ?? []);
  const touchKeys = new Set(latest.result.adjustment_plan.map((step) => step.key));
  const maintain = latest.result.dimensions.filter((dimension) => Math.abs(dimension.difference) < 8);
  const watch = latest.result.dimensions.filter((dimension) => Math.abs(dimension.difference) >= 8 && !touchKeys.has(dimension.key));
  const aggregate = aggregateToneResults(session.takes.map((take) => take.result));
  const stem = `tone-lab-session_${safeStem(session.name)}`;

  return (
    <section className="session-history" aria-labelledby="session-title">
      <div className="session-heading">
        <div>
          <p className="eyebrow">ADJUSTMENT SESSION / 調整履歴</p>
          <input
            key={`${session.id}-${session.name}`}
            id="session-title"
            className="session-name"
            aria-label="セッション名"
            defaultValue={session.name}
            maxLength={80}
            onBlur={(event) => {
              const value = event.target.value.trim();
              if (value && value !== session.name) onRename(value);
              else event.target.value = session.name;
            }}
          />
          <p>同じ参考音に対するテイクを残し、5軸の差が0へ近づいたかを確認します。</p>
        </div>
        <div className="session-primary-status">
          <strong>{latestDistance.toFixed(1)}</strong>
          <span>最新テイクの差</span>
          <small>{distanceLabel(latestDistance, previousDistance)}</small>
        </div>
      </div>

      <div className="session-focus-grid">
        <article><span>今回触る</span><strong>{latest.result.adjustment_plan.map((step) => step.label).join("・") || "なし"}</strong></article>
        <article><span>維持する</span><strong>{maintain.map((dimension) => dimension.label).join("・") || "なし"}</strong></article>
        <article><span>様子を見る</span><strong>{watch.map((dimension) => dimension.label).join("・") || "なし"}</strong></article>
      </div>

      <section className="aggregate-section" aria-labelledby="aggregate-title">
        <div className="aggregate-heading">
          <div>
            <p className="eyebrow">STABLE RESULT / 統合判定</p>
            <h3 id="aggregate-title">直近{aggregate.used_take_count}テイクの代表値</h3>
            <p>最大3テイクの中央値を使い、1回だけの強いピッキングや演奏ミスの影響を抑えます。</p>
          </div>
          <div className="aggregate-distance"><strong>{aggregate.representative_distance.toFixed(1)}</strong><span>代表的な差</span></div>
        </div>
        <div className="aggregate-grid">
          {aggregate.axes.map((axis) => (
            <article key={axis.key} className={`confidence-${axis.confidence}`}>
              <div><span>{axis.label}</span><strong>{axis.median_difference > 0 ? "+" : ""}{axis.median_difference.toFixed(0)}</strong></div>
              <p>信頼度 {confidenceLabel(axis.confidence)}・{axis.confidence_score.toFixed(0)}%</p>
              <div className="confidence-meter" aria-label={`${axis.label}の信頼度 ${axis.confidence_score.toFixed(0)}%`}><span style={{ width: `${axis.confidence_score}%` }} /></div>
              <small>ばらつき ±{axis.median_absolute_deviation.toFixed(1)} / 方向一致 {(axis.direction_agreement * 100).toFixed(0)}%</small>
              <p className="confidence-reason">{axis.reason}</p>
            </article>
          ))}
        </div>
        {aggregate.used_take_count < 3 ? <p className="aggregate-advice">あと{3 - aggregate.used_take_count}テイク録ると、演奏差を含めた信頼度をより安定して判断できます。</p> : null}
      </section>

      <div className="session-table-wrap">
        <table className="session-table">
          <thead><tr><th>テイク</th><th>差の大きさ</th>{latest.result.dimensions.map((dimension) => <th key={dimension.key}>{dimension.label}</th>)}<th>変更メモ</th></tr></thead>
          <tbody>
            {session.takes.map((take, index) => {
              const distance = toneDistance(take.result);
              const before = session.takes[index - 1] ?? null;
              const beforeByKey = new Map(before?.result.dimensions.map((dimension) => [dimension.key, dimension]) ?? []);
              return (
                <tr key={take.id}>
                  <th scope="row">#{index + 1}<small>{new Date(take.created_at).toLocaleString("ja-JP")}</small></th>
                  <td><strong>{distance.toFixed(1)}</strong><small>{distanceLabel(distance, before ? toneDistance(before.result) : null)}</small></td>
                  {take.result.dimensions.map((dimension) => {
                    const kind = changeKind(dimension.difference, beforeByKey.get(dimension.key)?.difference ?? null);
                    return <td key={dimension.key}><strong>{dimension.difference > 0 ? "+" : ""}{dimension.difference.toFixed(0)}</strong><small>{changeLabel(kind)}</small></td>;
                  })}
                  <td>{take.note || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="latest-change-grid">
        {latest.result.dimensions.map((dimension) => {
          const kind = changeKind(dimension.difference, previousByKey.get(dimension.key)?.difference ?? null);
          return <article key={dimension.key} className={`trend-${kind}`}><span>{dimension.label}</span><strong>{dimension.difference > 0 ? "+" : ""}{dimension.difference.toFixed(0)}</strong><small>{changeLabel(kind)}</small></article>;
        })}
      </div>

      <label className="take-note">
        最新テイクで変更したこと
        <textarea key={latest.id} defaultValue={latest.note} maxLength={500} placeholder="例: 高域を少し下げた、入力レベルを揃えた" onBlur={(event) => onUpdateNote(latest.id, event.target.value.trim())} />
      </label>

      <div className="session-actions">
        <button type="button" className="session-next" onClick={onNextTake}>この参考音で次のテイク</button>
        <button type="button" onClick={() => download(`${stem}.md`, sessionMarkdown(session), "text/markdown;charset=utf-8")}>履歴レポート</button>
        <button type="button" onClick={() => download(`${stem}.json`, JSON.stringify(sessionPayload(session), null, 2), "application/json;charset=utf-8")}>履歴JSON</button>
      </div>

      <p className="session-note">差の値は音質点ではなく、5軸の参考音との差です。統合判定は直近最大3テイクの中央値であり、信頼度は位置一致・入力品質・テイク間ばらつき・方向一致から算出します。</p>
    </section>
  );
}
