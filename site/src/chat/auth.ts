/**
 * Sign-in is one seam so the chat never knows how the credential was obtained.
 *
 *   developer-key  Today. A person pastes an `sk_shamwari_…` key, kept on this
 *                  device and sent only to the Shamwari API. For testing.
 *   mukoko         Behind a build flag, off. A WorkOS access token, held in
 *                  memory only and fetched from the session Worker's
 *                  cookie-authenticated GET (docs/chat-signin.md). Never a minted
 *                  per-person key, and never written to any storage.
 */
export interface AuthProvider {
  readonly kind: 'developer-key' | 'mukoko';
  /** The credential in memory right now. It may have expired; `ensureKey` is the one that renews. */
  getKey(): string | null;
  /** Whether the person is, as far as the app knows, signed in. Cheap, synchronous. */
  signedIn(): boolean;
  /** A credential good to send, renewing it silently if it has expired; null if there is none. */
  ensureKey(): Promise<string | null>;
  /** One silent renewal. True if a credential is now held. */
  refresh(): Promise<boolean>;
  /** The server said the credential is not good, even after a renewal: forget it. */
  invalidate(): void;
  /** Developer key only. */
  setKey?(key: string): boolean;
  signOut(): void | Promise<void>;
}

const STORAGE_KEY = 'shamwari.devkey';

/** The gateway only accepts keys with this prefix (gateway/src/auth.ts). */
export const isPlausibleKey = (k: string): boolean => /^sk_shamwari_[A-Za-z0-9_-]{4,}$/.test(k.trim());

type KeyStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function developerKey(storage?: KeyStorage): AuthProvider {
  let memory: string | null = null; // survives a blocked localStorage for this tab
  // Resolved on use, inside each try: merely reading `localStorage` throws a
  // SecurityError when site data is blocked, and that must not kill the app.
  const store = (): KeyStorage => storage ?? localStorage;
  return {
    kind: 'developer-key',
    signedIn() {
      return this.getKey() !== null;
    },
    async ensureKey() {
      return this.getKey();
    },
    async refresh() {
      return false; // a pasted key does not renew
    },
    invalidate() {
      /* the person can see the key was refused and replace it */
    },
    getKey() {
      try {
        return store().getItem(STORAGE_KEY) ?? memory;
      } catch {
        return memory;
      }
    },
    setKey(key) {
      const k = key.trim();
      if (!isPlausibleKey(k)) return false;
      memory = k;
      try {
        store().setItem(STORAGE_KEY, k);
      } catch {
        /* kept in memory for this tab only */
      }
      return true;
    },
    signOut() {
      memory = null;
      try {
        store().removeItem(STORAGE_KEY);
      } catch {
        /* nothing stored */
      }
    },
  };
}
