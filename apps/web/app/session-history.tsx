"use client";

import type { ToneSession } from "@/lib/session";
import { sessionMarkdown, sessionPayload, toneDistance } from "@/lib/session";

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

function changeLabel(current: number, previous: number | null) {
  if (previous === null) return "開始";
  const delta = Math.abs(current) - Math.abs(previous);
  if (delta <= -2) return "改善";
  if (delta >= 2) return "悪化";
  return "維持";
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
  const latestByKey = new Map(latest.result.dimensions.map((dimension) => [dimension.key, dimension]));
  const previousByKey = new Map(previous?.result.dimensions.map((dimension) => [dimension.key, dimension]) ?? []);
  const touchKeys = new Set(latest.result.adjustment_plan.map((step) => step.key));
  const maintain = latest.result.dimensions.filter((dimension) => Math.abs(dimension.difference) < 8);
  const watch = latest.result.dimensions.filter((dimension) => Math.abs(dimension.difference) >= 8 && !touchKeys.has(dimension.key));
  const stem = `tone-lab-session_${safeStem(session.name)}`;

  return (
    <section className="session-history" aria-labelledby="session-title">
      <div className="session-heading">
        <div>
          <p className="eyebrow">ADJUSTMENT SESSION / 調整履歴</p>
          <input
            key={`${session.id}-${session.name}`}
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
          <span>参考との差の大きさ</span>
          <small>{distanceLabel(latestDistance, previousDistance)}</small>
        </div>
      </div>

      <div className="session-focus-grid">
        <article>
          <span>今回触る</span>
          <strong>{latest.result.adjustment_plan.map((step) => step.label).join("・") || "なし"}</strong>
        </article>
        <article>
          <span>維持する</span>
          <strong>{maintain.map((dimension) => dimension.label).join("・") || "なし"}</strong>
        </article>
        <article>
          <span>様子を見る</span>
          <strong>{watch.map((dimension) => dimension.label).join("・") || "なし"}</strong>
        </article>
      </div>

      <div className="session-table-wrap">
        <table className="session-table">
          <thead>
            <tr>
              <th>テイク</th>
              <th>差の大きさ</th>
              {latest.result.dimensions.map((dimension) => <th key={dimension.key}>{dimension.label}</th>)}
              <th>変更メモ</th>
            </tr>
          </thead>
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
                    const old = beforeByKey.get(dimension.key)?.difference ?? null;
                    return <td key={dimension.key}><strong>{dimension.difference > 0 ? "+" : ""}{dimension.difference.toFixed(0)}</strong><small>{changeLabel(dimension.difference, old)}</small></td>;
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
          const before = previousByKey.get(dimension.key)?.difference ?? null;
          return (
            <article key={dimension.key} className={`trend-${changeLabel(dimension.difference, before)}`}>
              <span>{dimension.label}</span>
              <strong>{dimension.difference > 0 ? "+" : ""}{dimension.difference.toFixed(0)}</strong>
              <small>{changeLabel(dimension.difference, before)}</small>
            </article>
          );
        })}
      </div>

      <label className="take-note">
        最新テイクで変更したこと
        <textarea
          key={latest.id}
          defaultValue={latest.note}
          maxLength={500}
          placeholder="例: 高域を少し下げた、入力レベルを揃えた"
          onBlur={(event) => onUpdateNote(latest.id, event.target.value.trim())}
        />
      </label>

      <div className="session-actions">
        <button type="button" className="session-next" onClick={onNextTake}>この参考音で次のテイク</button>
        <button type="button" onClick={() => download(`${stem}.md`, sessionMarkdown(session), "text/markdown;charset=utf-8")}>履歴レポート</button>
        <button type="button" onClick={() => download(`${stem}.json`, JSON.stringify(sessionPayload(session), null, 2), "application/json;charset=utf-8")}>履歴JSON</button>
      </div>

      <p className="session-note">この値は音質点ではなく、5軸それぞれの参考音との差の絶対値を合計したものです。小さいほど今回の5軸では近いことを表します。</p>
    </section>
  );
}
