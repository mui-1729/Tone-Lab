"use client";

import { useEffect, useState } from "react";
import { LiveComparison } from "@/app/live-comparison";
import { createId } from "@/lib/session";
import type { SessionTake, ToneSession } from "@/lib/session";
import { loadSession, saveSession } from "@/lib/session-storage";
import type { CompareResponse } from "@/lib/types";

export function LiveSessionPanel({
  sessionId,
  revision,
  onSessionUpdated,
}: {
  sessionId: string | null;
  revision: number;
  onSessionUpdated: (session: ToneSession) => void;
}) {
  const [session, setSession] = useState<ToneSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (!sessionId) {
        setSession(null);
        setError(null);
        return;
      }
      void loadSession(sessionId)
        .then((value) => {
          if (cancelled) return;
          setSession(value);
          setError(value ? null : "リアルタイム比較に使うセッションが見つかりません。");
        })
        .catch(() => {
          if (!cancelled) setError("リアルタイム比較用のセッションを読み込めませんでした。");
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [sessionId, revision]);

  if (!sessionId) {
    return (
      <section className="live-locked">
        <p className="eyebrow">LIVE MODE / リアルタイム比較</p>
        <strong>最初に通常比較を1回行ってください。</strong>
        <p>参考区間と位置合わせを確定した後、その参考音を使って演奏中の比較を開始できます。</p>
      </section>
    );
  }

  if (error) return <p className="live-error" role="alert">{error}</p>;
  if (!session) return <p className="live-loading">リアルタイム比較用のセッションを準備中…</p>;

  const activeSession = session;

  async function saveLiveTake(file: File, result: CompareResponse) {
    const latest = await loadSession(activeSession.id);
    const base = latest ?? activeSession;
    const now = new Date().toISOString();
    const take: SessionTake = {
      id: createId("take"),
      created_at: now,
      current_file: file,
      result,
      note: "リアルタイム比較から保存",
    };
    const nextSession: ToneSession = {
      ...base,
      updated_at: now,
      takes: [...base.takes, take],
    };
    await saveSession(nextSession);
    setSession(nextSession);
    onSessionUpdated(nextSession);
  }

  return <LiveComparison session={activeSession} onSaveTake={saveLiveTake} />;
}
