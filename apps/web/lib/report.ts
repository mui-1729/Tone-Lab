import type { CompareResponse } from "@/lib/types";

export type ReportFiles = {
  reference: string;
  current: string;
};

export function reportPayload(result: CompareResponse, files: ReportFiles) {
  return {
    exported_at: new Date().toISOString(),
    app: "Tone Lab MVP",
    files,
    alignment: result.alignment,
    quality: result.quality,
    summary: result.summary,
    adjustment_plan: result.adjustment_plan,
    dimensions: result.dimensions,
    features: {
      reference: result.reference,
      current: result.current,
    },
    disclaimer: result.disclaimer,
  };
}

export function reportMarkdown(result: CompareResponse, files: ReportFiles) {
  const payload = reportPayload(result, files);
  const lines = [
    "# Tone Lab 比較レポート",
    "",
    `- 出力日時: ${payload.exported_at}`,
    `- 参考音: ${files.reference}`,
    `- 自分の音: ${files.current}`,
    `- 位置補正: ${result.alignment.offset_seconds.toFixed(3)}秒`,
    `- 一致度: ${(result.alignment.confidence * 100).toFixed(0)}%`,
    `- 比較区間: ${result.alignment.overlap_seconds.toFixed(2)}秒`,
    "",
    "## 主な違い",
    "",
    ...result.summary.map((item) => `- ${item}`),
    "",
    "## 優先調整プラン",
    "",
  ];

  if (result.adjustment_plan.length) {
    result.adjustment_plan.forEach((step, index) => {
      lines.push(`### ${index + 1}. ${step.title}`);
      lines.push("");
      lines.push(`対象: ${step.label}（差 ${step.difference > 0 ? "+" : ""}${step.difference.toFixed(0)}）`);
      lines.push("");
      step.actions.forEach((action) => lines.push(`- ${action}`));
      lines.push("");
      lines.push(step.verify);
      lines.push("");
    });
  } else {
    lines.push("大きな調整差は検出されませんでした。");
    lines.push("");
  }

  lines.push("## 5つの質感差", "");
  result.dimensions.forEach((dimension) => {
    lines.push(`### ${dimension.label}: ${dimension.difference > 0 ? "+" : ""}${dimension.difference.toFixed(0)}`);
    lines.push("");
    lines.push(dimension.interpretation);
    dimension.evidence.forEach((item) => lines.push(`- ${item}`));
    lines.push("");
  });

  const warnings = [
    ...result.quality.reference.warnings.map((item) => `参考音: ${item}`),
    ...result.quality.current.warnings.map((item) => `自分の音: ${item}`),
    ...result.quality.comparison_warnings.map((item) => `比較条件: ${item}`),
  ];
  lines.push("## 入力状態", "");
  lines.push(...(warnings.length ? warnings.map((item) => `- ${item}`) : ["- 大きな問題は検出されませんでした。"]))
  lines.push("", "---", "", result.disclaimer, "");
  return lines.join("\n");
}
