import type { SessionSummary, ToneSession } from "@/lib/session";
import { sessionSummary } from "@/lib/session";

const DATABASE_NAME = "tone-lab";
const DATABASE_VERSION = 1;
const SESSION_STORE = "sessions";

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SESSION_STORE)) {
        const store = database.createObjectStore(SESSION_STORE, { keyPath: "id" });
        store.createIndex("updated_at", "updated_at");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDBを開けませんでした。"));
  });
}

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("端末内データの操作に失敗しました。"));
  });
}

export async function saveSession(session: ToneSession) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SESSION_STORE, "readwrite");
    await requestResult(transaction.objectStore(SESSION_STORE).put(session));
  } finally {
    database.close();
  }
}

export async function loadSession(id: string) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SESSION_STORE, "readonly");
    const value = await requestResult(transaction.objectStore(SESSION_STORE).get(id));
    return (value as ToneSession | undefined) ?? null;
  } finally {
    database.close();
  }
}

export async function listSessionSummaries(): Promise<SessionSummary[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SESSION_STORE, "readonly");
    const values = await requestResult(transaction.objectStore(SESSION_STORE).getAll()) as ToneSession[];
    return values
      .map(sessionSummary)
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at));
  } finally {
    database.close();
  }
}

export async function renameSession(id: string, name: string) {
  const session = await loadSession(id);
  if (!session) throw new Error("セッションが見つかりません。");
  await saveSession({ ...session, name: name.trim().slice(0, 80) || session.name, updated_at: new Date().toISOString() });
}

export async function deleteSession(id: string) {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SESSION_STORE, "readwrite");
    await requestResult(transaction.objectStore(SESSION_STORE).delete(id));
  } finally {
    database.close();
  }
}

export async function clearSessions() {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(SESSION_STORE, "readwrite");
    await requestResult(transaction.objectStore(SESSION_STORE).clear());
  } finally {
    database.close();
  }
}

export async function storageStatus() {
  if (!navigator.storage?.estimate) return { usage: null, quota: null, persisted: null };
  const estimate = await navigator.storage.estimate();
  const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : null;
  return { usage: estimate.usage ?? null, quota: estimate.quota ?? null, persisted };
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}
