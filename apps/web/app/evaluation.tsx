"use client";

import { useState } from "react";
import type { AudioSelection, CompareResponse, ToneKey } from "@/lib/types";

type Rating = "agree" | "disagree" | "unsure";
type Overall = "agree" | "partial" | "disagree" | "";

const RATING_LABELS: Record<Rating, string> = {
  agree: "合っている",
  disagree: "違う",
  unsure: "わからない",
};

function safeStem(filename: string) {
  return filename.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9ぁ-んァ-ヶ一-龠_-]+/g, "-").slice(0, 36);
}

function downloadJson(filename: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function EvaluationSection({
  result,
  referenceName,
  currentName,
  referenceSelection,
}: {
  result: CompareResponse;
  referenceName: string;
  currentName: string;
  referenceSelection?: AudioSelection | null;
}) {
  const [ratings, setRatings] = useState<Partial<Record<ToneKey, Rating>>>({});
  const [overall, setOverall] = useState<Overall>("");
  const [notes, setNotes] = useState("");
  const ratedCount = Object.keys(ratings).length;

  function setRating(key: ToneKey, rating: Rating) {
    setRatings((previous) => ({ ...previous, [key]: rating }));
  }

  function save() {
    const dimensionFeedback = result.dimensions.map((dimension) => ({
      key: dimension.key,
      label: dimension.label,
      predicted_difference: dimension.difference,
      rating: ratings[dimension.key] ?? "unrated",
    }));
    const filename = `tone-lab-evaluation_${safeStem(referenceName)}_vs_${safeStem(currentName)}.json`;
    downloadJson(filename, {
      schema_version: 3,
      app: "Tone Lab MVP 1.3",
      evaluated_at: new Date().toISOString(),
      files: { reference: referenceName, current: currentName },
      reference_selection: referenceSelection ?? null,
      overall,
      notes: notes.trim(),
      alignment: result.alignment,
      quality: result.quality,
      dimensions: dimensionFeedback,
      features: { reference: result.reference, current: result.current },
    });
  }

  return (
    <section className="evaluation-section" aria-labelledby="evaluation-title">
      <div className="section-heading compact-heading">
        <p className="eyebrow">HUMAN CHECK / 聴感評価</p>
        <h2 id="evaluation-title">耳で結果を採点する</h2>
        <p>数値を正解として扱わず、A/B試聴後に方向性が合っているか記録します。評価は送信されず、JSONとして手元に保存されます。</p>
      </div>

      <div className="overall-rating">
        <span>全体として納得できる</span>
        <div role="group" aria-label="全体評価">
          {([
            ["agree", "はい"],
            ["partial", "一部"],
            ["disagree", "いいえ"],
          ] as const).map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={overall === value ? "active" : ""}
              aria-pressed={overall === value}
              onClick={() => setOverall(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="dimension-ratings">
        {result.dimensions.map((dimension) => (
          <article key={dimension.key}>
            <div>
              <h3>{dimension.label}</h3>
              <p>予測 {dimension.difference > 0 ? "+" : ""}{dimension.difference.toFixed(0)}</p>
            </div>
            <div className="rating-buttons" role="group" aria-label={`${dimension.label}の評価`}>
              {(Object.keys(RATING_LABELS) as Rating[]).map((rating) => (
                <button
                  type="button"
                  key={rating}
                  className={ratings[dimension.key] === rating ? "active" : ""}
                  aria-pressed={ratings[dimension.key] === rating}
                  onClick={() => setRating(dimension.key, rating)}
                >
                  {RATING_LABELS[rating]}
                </button>
              ))}
            </div>
          </article>
        ))}
      </div>

      <label className="evaluation-notes">
        気づいたこと
        <textarea
          rows={3}
          value={notes}
          maxLength={1000}
          placeholder="例: 明るさは合っているが、粗さは実際より大きく感じる"
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>

      <div className="evaluation-footer">
        <span>{ratedCount}/5項目を評価済み</span>
        <button type="button" onClick={save} disabled={!overall && ratedCount === 0 && !notes.trim()}>
          評価データを保存
        </button>
      </div>
    </section>
  );
}
