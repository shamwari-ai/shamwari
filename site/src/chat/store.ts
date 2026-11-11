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
  /** Pinned chats sit at the top of the drawer. */
  pinned?: boolean;
  /** The project this chat belongs to, when it belongs to one. */
  projectId?: string;
}

/** A named group of chats. Kept on this device like the chats are. */
export interface Project {
  id: string;
  name: string;
  pinned?: boolean;
  updatedAt: number;
}

/** An answer the person chose to keep: its text and the sources behind it, apart from the chat it came from. */
export interface Artifact {
  id: string;
  /** The chat it was saved from; the chat may since have been deleted. */
  threadId: string;
  title: string;
  text: string;
  citations: Answer['citations'];
  savedAt: number;
}

export interface Store {
  list(): Promise<Thread[]>;
  put(thread: Thread): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  projects(): Promise<Project[]>;
  putProject(project: Project): Promise<void>;
  removeProject(id: string): Promise<void>;
  artifacts(): Promise<Artifact[]>;
  putArtifact(artifact: Artifact): Promise<void>;
  removeArtifact(id: string): Promise<void>;
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
  const projects = new Map<string, Project>();
  const artifacts = new Map<string, Artifact>();
  return {
    list: async () => [...threads.values()].sort((a, b) => b.updatedAt - a.updatedAt),
    put: async (t) => void threads.set(t.id, structuredClone(t)),
    remove: async (id) => void threads.delete(id),
    clear: async () => {
      threads.clear();
      projects.clear();
      artifacts.clear();
    },
    projects: async () => [...projects.values()].sort((a, b) => b.updatedAt - a.updatedAt),
    putProject: async (p) => void projects.set(p.id, structuredClone(p)),
    removeProject: async (id) => void projects.delete(id),
    artifacts: async () => [...artifacts.values()].sort((a, b) => b.savedAt - a.savedAt),
    putArtifact: async (a) => void artifacts.set(a.id, structuredClone(a)),
    removeArtifact: async (id) => void artifacts.delete(id),
  };
}

const DB = 'shamwari-chat';
const TABLE = 'threads';
const PROJECTS = 'projects';
const ARTIFACTS = 'artifacts';

const wrap = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((ok, no) => {
    req.onsuccess = () => ok(req.result);
    req.onerror = () => no(req.error);
  });

export async function openStore(): Promise<Store> {
  if (typeof indexedDB === 'undefined') return memoryStore();
  try {
    const db = await new Promise<IDBDatabase>((ok, no) => {
      const open = indexedDB.open(DB, 2);
      open.onupgradeneeded = () => {
        // Version 2 adds projects and artifacts; threads from version 1 are kept as they are.
        for (const name of [TABLE, PROJECTS, ARTIFACTS]) {
          if (!open.result.objectStoreNames.contains(name)) open.result.createObjectStore(name, { keyPath: 'id' });
        }
      };
      open.onsuccess = () => ok(open.result);
      open.onerror = () => no(open.error);
      open.onblocked = () => no(new Error('blocked'));
    });
    const tx = (name: string, mode: IDBTransactionMode) => db.transaction(name, mode).objectStore(name);
    return {
      list: async () =>
        ((await wrap(tx(TABLE, 'readonly').getAll())) as Thread[]).sort((a, b) => b.updatedAt - a.updatedAt),
      put: async (t) => void (await wrap(tx(TABLE, 'readwrite').put(t))),
      remove: async (id) => void (await wrap(tx(TABLE, 'readwrite').delete(id))),
      clear: async () => {
        await Promise.all([TABLE, PROJECTS, ARTIFACTS].map((n) => wrap(tx(n, 'readwrite').clear())));
      },
      projects: async () =>
        ((await wrap(tx(PROJECTS, 'readonly').getAll())) as Project[]).sort((a, b) => b.updatedAt - a.updatedAt),
      putProject: async (p) => void (await wrap(tx(PROJECTS, 'readwrite').put(p))),
      removeProject: async (id) => void (await wrap(tx(PROJECTS, 'readwrite').delete(id))),
      artifacts: async () =>
        ((await wrap(tx(ARTIFACTS, 'readonly').getAll())) as Artifact[]).sort((a, b) => b.savedAt - a.savedAt),
      putArtifact: async (a) => void (await wrap(tx(ARTIFACTS, 'readwrite').put(a))),
      removeArtifact: async (id) => void (await wrap(tx(ARTIFACTS, 'readwrite').delete(id))),
    };
  } catch {
    return memoryStore();
  }
}
