import type { Answer, AskError, Scope } from './types';

/**
 * Conversation history lives on the device and nowhere else (decision recorded
 * in docs/chat-app.md): IndexedDB here, and the app never syncs it anywhere. If IndexedDB
 * is unavailable (some private modes, very old WebViews) the chat still works
 * for the life of the tab through the in-memory fallback.
 */

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: number;
  scope?: Scope;
  /** user messages: `queued` = written offline, waiting to be sent. */
  status?: 'sent' | 'queued' | 'failed';
  /** assistant messages */
  answer?: Answer;
  /** Why a queued question is waiting, when it is not simply offline (a brief 503, say). */
  hint?: 'offline' | 'unavailable' | 'busy';
  /** Delivery attempts that got no answer while the browser said it was online. */
  attempts?: number;
  /** user messages whose ask failed: why, so a reload still shows it. */
  error?: Pick<AskError, 'kind' | 'retryAfterSec' | 'upgradeUrl'>;
}

export interface Thread {
  id: string;
  title: string;
  updatedAt: number;
  messages: StoredMessage[];
}

export interface Store {
  list(): Promise<Thread[]>;
  put(thread: Thread): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

export const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const titleOf = (text: string): string => {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > 48 ? `${t.slice(0, 47)}…` : t;
};

export function memoryStore(): Store {
  const threads = new Map<string, Thread>();
  return {
    list: async () => [...threads.values()].sort((a, b) => b.updatedAt - a.updatedAt),
    put: async (t) => void threads.set(t.id, structuredClone(t)),
    remove: async (id) => void threads.delete(id),
    clear: async () => threads.clear(),
  };
}

const DB = 'shamwari-chat';
const TABLE = 'threads';

const wrap = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((ok, no) => {
    req.onsuccess = () => ok(req.result);
    req.onerror = () => no(req.error);
  });

export async function openStore(): Promise<Store> {
  if (typeof indexedDB === 'undefined') return memoryStore();
  try {
    const db = await new Promise<IDBDatabase>((ok, no) => {
      const open = indexedDB.open(DB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(TABLE, { keyPath: 'id' });
      open.onsuccess = () => ok(open.result);
      open.onerror = () => no(open.error);
      open.onblocked = () => no(new Error('blocked'));
    });
    const tx = (mode: IDBTransactionMode) => db.transaction(TABLE, mode).objectStore(TABLE);
    return {
      list: async () =>
        ((await wrap(tx('readonly').getAll())) as Thread[]).sort((a, b) => b.updatedAt - a.updatedAt),
      put: async (t) => void (await wrap(tx('readwrite').put(t))),
      remove: async (id) => void (await wrap(tx('readwrite').delete(id))),
      clear: async () => void (await wrap(tx('readwrite').clear())),
    };
  } catch {
    return memoryStore();
  }
}
