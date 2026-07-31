import { aggregateToneResults } from "@/lib/aggregate";
import type { AudioSelection, CompareResponse, ToneKey } from "@/lib/types";

export type BlindTrial = {
  id: string;
  created_at: string;
  earlier_take_id: string;
  later_take_id: string;
  answer: "earlier" | "later" | "unsure";
  x_take_id: string;
  y_take_id: string;
};

export type SessionTake = {
  id: string;
  created_at: string;
  current_file: File;
  result: CompareResponse;
  note: string;
};

export type ToneSession = {
  schema_version: 1;
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  reference_file: File;
  analyzed_reference_file: File;
  reference_selection: AudioSelection | null;
  takes: SessionTake[];
  blind_trials: BlindTrial[];
};

export type SessionSummary = {
  id: string;
  name: string;
  reference_name: string;
  updated_at: string;
  take_count: number;
  latest_distance: number | null;
};

export function createId(prefix: string) {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

export function toneDistance(result: CompareResponse) {
  return result.dimensions.reduce((total, dimension) => total + Math.abs(dimension.difference), 0);
}

export function sessionSummary(session: ToneSession): SessionSummary {
  const latest = session.takes.at(-1);
  return {
    id: session.id,
    name: session.name,
    reference_name: session.reference_file.name,
    updated_at: session.updated_at,
    take_count: session.takes.length,
    latest_distance: latest ? toneDistance(latest.result) : null,
  };
}

export function updateSessionTakeNote(session: ToneSession, takeId: string, note: string): ToneSession {
  return {
    ...session,
    updated_at: new Date().toISOString(),
    takes: session.takes.map((take) => take.id === takeId ? { ...take, note } : take),
  };
}

export function sessionPayload(session: ToneSession) {
  const aggregate = aggregateToneResults(session.takes.map((take) => take.result));
  return {
    schema_version: 2,
    exported_at: new Date().toISOString(),
    app: "Tone Lab MVP 1.2",
    session: {
      id: session.id,
      name: session.name,
      created_at: session.created_at,
      updated_at: session.updated_at,
      reference_file: session.reference_file.name,
      reference_selection: session.reference_selection,
      aggregate,
      takes: session.takes.map((take, index) => ({
        index: index + 1,
        id: take.id,
        created_at: take.created_at,
        current_file: take.current_file.name,
        note: take.note,
        distance: toneDistance(take.result),
        result: take.result,
      })),
      blind_trials: session.blind_trials,
    },
  };
}

export function sessionMarkdown(session: ToneSession) {
  const aggregate = aggregateToneResults(session.takes.map((take) => take.result));
  const lines = [
    `# Tone Lab 調整セッション: ${session.name}`,
    "",
    `- 参考音: ${session.reference_file.name}`,
    `- 作成日時: ${session.created_at}`,
    `- 更新日時: ${session.updated_at}`,
  ];
  if (session.reference_selection) {
    lines.push(`- 参考区間: ${session.reference_selection.start_seconds.toFixed(2)}〜${session.reference_selection.end_seconds.toFixed(2)}秒`);
  }
  lines.push("", `## 統合判定（直近${aggregate.used_take_count}テイク）`, "");
  lines.push(`- 代表的な参考との差: ${aggregate.representative_distance.toFixed(1)}`);
  for (const axis of aggregate.axes) {
    lines.push(`- ${axis.label}: ${axis.median_difference > 0 ? "+" : ""}${axis.median_difference.toFixed(0)} / 信頼度 ${axis.confidence_score.toFixed(0)}% / ばらつき ${axis.median_absolute_deviation.toFixed(1)}`);
  }
  lines.push("", "## テイク履歴", "");
  session.takes.forEach((take, index) => {
    lines.push(`### ${index + 1}. ${take.current_file.name}`);
    lines.push("");
    lines.push(`- 日時: ${take.created_at}`);
    lines.push(`- 参考との差の大きさ: ${toneDistance(take.result).toFixed(1)}`);
    if (take.note) lines.push(`- 変更メモ: ${take.note}`);
    for (const dimension of take.result.dimensions) {
      lines.push(`- ${dimension.label}: ${dimension.difference > 0 ? "+" : ""}${dimension.difference.toFixed(0)}`);
    }
    lines.push("");
  });
  return lines.join("\n");
}

export const TONE_KEYS: ToneKey[] = ["brightness", "body", "attack", "compression", "roughness"];
