"use client";

import type { AudioSelection, CompareResponse } from "@/lib/types";
import { reportMarkdown, reportPayload } from "@/lib/report";

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

function safeStem(filename: string) {
  return filename.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9ぁ-んァ-ヶ一-龠_-]+/g, "-").slice(0, 48);
}

export function ResultActions({
  result,
  referenceName,
  currentName,
  referenceSelection,
  onReset,
}: {
  result: CompareResponse;
  referenceName: string;
  currentName: string;
  referenceSelection?: AudioSelection | null;
  onReset: () => void;
}) {
  const files = { reference: referenceName, current: currentName, reference_selection: referenceSelection };
  const stem = `tone-lab_${safeStem(referenceName)}_vs_${safeStem(currentName)}`;

  return (
    <section className="result-actions" aria-label="比較結果の操作">
      <div>
        <p className="eyebrow">SAVE / 保存</p>
        <p>音源自体は保存せず、比較結果だけを手元へ書き出します。</p>
      </div>
      <div className="result-action-buttons">
        <button
          type="button"
          onClick={() => download(`${stem}.md`, reportMarkdown(result, files), "text/markdown;charset=utf-8")}
        >
          レポートを保存
        </button>
        <button
          type="button"
          onClick={() => download(`${stem}.json`, JSON.stringify(reportPayload(result, files), null, 2), "application/json;charset=utf-8")}
        >
          JSONを保存
        </button>
        <button type="button" onClick={() => window.print()}>印刷</button>
        <button type="button" className="reset-button" onClick={onReset}>新しく比較</button>
      </div>
    </section>
  );
}
