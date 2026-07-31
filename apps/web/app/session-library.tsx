"use client";

import { useCallback, useEffect, useState } from "react";
import type { SessionSummary, ToneSession } from "@/lib/session";
import {
  clearSessions,
  deleteSession,
  listSessionSummaries,
  loadSession,
  renameSession,
  requestPersistentStorage,
  storageStatus,
} from "@/lib/session-storage";

type StorageInfo = {
  usage: number | null;
  quota: number | null;
  persisted: boolean | null;
};

function formatBytes(value: number | null) {
  if (value === null) return "不明";
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(1)} GB`;
}

export function SessionLibrary({
  revision,
  activeSessionId,
  onLoad,
  onActiveDeleted,
}: {
  revision: number;
  activeSessionId: string | null;
  onLoad: (session: ToneSession) => void;
  onActiveDeleted: () => void;
}) {
  const [summaries, setSummaries] = useState<SessionSummary[]>([]);
  const [storage, setStorage] = useState<StorageInfo>({ usage: null, quota: null, persisted: null });
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (cancelled?: () => boolean) => {
    try {
      const [nextSummaries, nextStorage] = await Promise.all([listSessionSummaries(), storageStatus()]);
      if (cancelled?.()) return;
      setSummaries(nextSummaries);
      setStorage(nextStorage);
      setError(null);
    } catch {
      if (!cancelled?.()) setError("端末内ライブラリを読み込めませんでした。ブラウザの保存設定を確認してください。");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void refresh(() => cancelled);
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [refresh, revision]);

  async function load(id: string) {
    setLoadingId(id);
    try {
      const session = await loadSession(id);
      if (!session) throw new Error("not found");
      onLoad(session);
      setError(null);
    } catch {
      setError("選択したセッションを開けませんでした。データが破損している可能性があります。");
    } finally {
      setLoadingId(null);
    }
  }

  async function rename(summary: SessionSummary) {
    const value = window.prompt("新しいセッション名", summary.name)?.trim();
    if (!value || value === summary.name) return;
    try {
      await renameSession(summary.id, value);
      if (summary.id === activeSessionId) {
        const renamed = await loadSession(summary.id);
        if (renamed) onLoad(renamed);
      }
      await refresh();
    } catch {
      setError("セッション名を変更できませんでした。");
    }
  }

  async function remove(summary: SessionSummary) {
    if (!window.confirm(`「${summary.name}」と端末内の音源・履歴を削除しますか？`)) return;
    try {
      await deleteSession(summary.id);
      if (summary.id === activeSessionId) onActiveDeleted();
      await refresh();
    } catch {
      setError("セッションを削除できませんでした。");
    }
  }

  async function removeAll() {
    if (!summaries.length || !window.confirm("端末内に保存したすべての参考音と比較履歴を削除しますか？")) return;
    try {
      await clearSessions();
      onActiveDeleted();
      await refresh();
    } catch {
      setError("端末内ライブラリを削除できませんでした。");
    }
  }

  async function persist() {
    try {
      const granted = await requestPersistentStorage();
      setStorage((previous) => ({ ...previous, persisted: granted }));
      if (!granted) setError("ブラウザは永続保存を許可しませんでした。空き容量が少ない場合、保存内容が削除される可能性があります。");
      else setError(null);
    } catch {
      setError("永続保存を要求できませんでした。");
    }
  }

  return (
    <section className="session-library" aria-labelledby="library-title">
      <div className="library-heading">
        <div>
          <p className="eyebrow">LOCAL LIBRARY / 端末内ライブラリ</p>
          <h2 id="library-title">参考音と調整履歴</h2>
          <p>音源と結果はこのブラウザの端末内だけに保存されます。サーバーや他の端末とは同期しません。</p>
        </div>
        <div className="storage-status">
          <span>{formatBytes(storage.usage)} / {formatBytes(storage.quota)}</span>
          <strong>{storage.persisted ? "永続保存済み" : "通常保存"}</strong>
        </div>
      </div>

      {error ? <p className="library-error" role="alert">{error}</p> : null}

      {summaries.length ? (
        <div className="library-list">
          {summaries.map((summary) => (
            <article key={summary.id} className={summary.id === activeSessionId ? "active" : ""}>
              <button type="button" className="library-open" disabled={loadingId === summary.id} onClick={() => void load(summary.id)}>
                <span>{summary.name}</span>
                <small>{summary.reference_name}</small>
                <small>{new Date(summary.updated_at).toLocaleString("ja-JP")} / {summary.take_count}テイク</small>
              </button>
              <div className="library-distance">
                <strong>{summary.latest_distance === null ? "—" : summary.latest_distance.toFixed(1)}</strong>
                <span>最新の差</span>
              </div>
              <div className="library-item-actions">
                <button type="button" onClick={() => void rename(summary)}>名前変更</button>
                <button type="button" onClick={() => void remove(summary)}>削除</button>
              </div>
            </article>
          ))}
        </div>
      ) : <p className="library-empty">保存されたセッションはまだありません。最初の比較が完了すると自動保存されます。</p>}

      <div className="library-footer">
        {!storage.persisted ? <button type="button" onClick={() => void persist()}>保存を保持しやすくする</button> : null}
        {summaries.length ? <button type="button" className="library-clear" onClick={() => void removeAll()}>すべて削除</button> : null}
      </div>
    </section>
  );
}
