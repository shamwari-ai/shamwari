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
  status?: 'sent' | 'queued' | 'failed' | 'local';
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

/** The store nobody owns: developer-key mode, a device before anyone has signed in, and chats from before stores were per person. */
const DB = 'shamwari-chat';
const dbName = (userKey: string | null) => (userKey ? `${DB}-u-${userKey}` : DB);
const TABLE = 'threads';
const PROJECTS = 'projects';
const ARTIFACTS = 'artifacts';

const wrap = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((ok, no) => {
    req.onsuccess = () => ok(req.result);
    req.onerror = () => no(req.error);
  });

export async function openStore(userKey: string | null = null): Promise<Store> {
  if (typeof indexedDB === 'undefined') return memoryStore();
  try {
    const db = await new Promise<IDBDatabase>((ok, no) => {
      const open = indexedDB.open(dbName(userKey), 2);
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

/**
 * A store that can be pointed at another person's database without the code holding it being told: everything in
 * the app keeps using one object. `switchTo` opens the other database; with `adopt` the contents of the unowned store
 * (what a device held before stores were per person) move into it, so the first person to sign in keeps the chats
 * that were already there and nobody else ever sees them.
 */
export interface SwitchableStore extends Store {
  readonly key: string | null;
  switchTo(userKey: string | null, adopt?: boolean): Promise<void>;
}

export async function openSwitchableStore(initialKey: string | null): Promise<SwitchableStore> {
  let current = await openStore(initialKey);
  let key = initialKey;
  const delegate = <K extends keyof Store>(name: K): Store[K] => ((...a: unknown[]) => (current[name] as (...x: unknown[]) => unknown)(...a)) as Store[K];
  return {
    get key() {
      return key;
    },
    list: delegate('list'),
    put: delegate('put'),
    remove: delegate('remove'),
    clear: delegate('clear'),
    projects: delegate('projects'),
    putProject: delegate('putProject'),
    removeProject: delegate('removeProject'),
    artifacts: delegate('artifacts'),
    putArtifact: delegate('putArtifact'),
    removeArtifact: delegate('removeArtifact'),
    async switchTo(next, adopt = false) {
      if (next === key) return;
      const from = current;
      const to = await openStore(next);
      if (adopt && key === null) {
        // Copy first, clear after: a failure part-way leaves the data in the unowned store, never nowhere.
        for (const t of await from.list()) await to.put(t);
        for (const p of await from.projects()) await to.putProject(p);
        for (const a of await from.artifacts()) await to.putArtifact(a);
        await from.clear();
      }
      current = to;
      key = next;
    },
  };
}
