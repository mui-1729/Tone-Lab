import type { CompareResponse } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function compareAudio(
  reference: File,
  current: File,
  signal?: AbortSignal,
): Promise<CompareResponse> {
  const form = new FormData();
  form.append("reference", reference);
  form.append("current", current);

  const response = await fetch(`${API_URL}/api/v1/compare`, {
    method: "POST",
    body: form,
    signal,
  });

  if (!response.ok) {
    let message = "解析に失敗しました。";
    try {
      const error = (await response.json()) as { detail?: string };
      if (error.detail) message = error.detail;
    } catch {
      // Keep the fallback message when the response is not JSON.
    }
    throw new Error(message);
  }

  return (await response.json()) as CompareResponse;
}
