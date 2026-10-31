/**
 * Sign-in is one seam so the chat never knows how the key was obtained.
 *
 *   developer key  — today. A person pastes an `sk_shamwari_…` key, kept on this
 *                    device and sent only to the Shamwari API. For testing.
 *   Mukoko Account — not built. The proposal for how a signed-in person gets a
 *                    metered per-person key is in docs/chat-app.md. It will be a
 *                    second AuthProvider; nothing in the chat changes.
 */
export interface AuthProvider {
  readonly kind: 'developer-key';
  getKey(): string | null;
  setKey(key: string): boolean;
  signOut(): void;
}

const STORAGE_KEY = 'shamwari.devkey';

/** The gateway only accepts keys with this prefix (gateway/src/auth.ts). */
export const isPlausibleKey = (k: string): boolean => /^sk_shamwari_[A-Za-z0-9_-]{4,}$/.test(k.trim());

export function developerKey(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = localStorage): AuthProvider {
  let memory: string | null = null; // survives a blocked localStorage for this tab
  return {
    kind: 'developer-key',
    getKey() {
      try {
        return storage.getItem(STORAGE_KEY) ?? memory;
      } catch {
        return memory;
      }
    },
    setKey(key) {
      const k = key.trim();
      if (!isPlausibleKey(k)) return false;
      memory = k;
      try {
        storage.setItem(STORAGE_KEY, k);
      } catch {
        /* kept in memory for this tab only */
      }
      return true;
    },
    signOut() {
      memory = null;
      try {
        storage.removeItem(STORAGE_KEY);
      } catch {
        /* nothing stored */
      }
    },
  };
}
