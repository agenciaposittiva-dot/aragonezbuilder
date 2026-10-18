/*
 * Cópia local temporária de alterações ainda não confirmadas pelo servidor.
 * É só um apoio para recuperar trabalho depois de queda de conexão, fechamento
 * da aba ou falha do navegador — nunca a cópia oficial (essa fica no servidor).
 * Usa IndexedDB (cabe documentos grandes) e cai para localStorage se precisar.
 */

export type LocalDraft<T = unknown> = {
  data: T;
  /** Revisão do servidor sobre a qual as alterações foram feitas. */
  baseRevision: number | null;
  savedAt: number;
};

const DB = "aragonez-drafts";
const STORE = "drafts";
const PREFIX = "aragonez:draft:";

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  const db = await openDb();
  if (!db) throw new Error("indexeddb-indisponivel");
  return new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function saveLocalDraft<T>(key: string, draft: LocalDraft<T>): Promise<void> {
  try {
    await withStore("readwrite", (s) => s.put(draft, key));
  } catch {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(draft));
    } catch {
      /* sem espaço ou bloqueado: o autosave no servidor continua sendo a cópia oficial */
    }
  }
}

export async function loadLocalDraft<T>(key: string): Promise<LocalDraft<T> | null> {
  try {
    const found = await withStore<LocalDraft<T>>("readonly", (s) => s.get(key) as IDBRequest<LocalDraft<T>>);
    if (found) return found;
  } catch {
    /* tenta o localStorage */
  }
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as LocalDraft<T>) : null;
  } catch {
    return null;
  }
}

export async function clearLocalDraft(key: string): Promise<void> {
  try {
    await withStore("readwrite", (s) => s.delete(key));
  } catch {
    /* segue para o localStorage */
  }
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    /* nada a fazer */
  }
}
