import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { Session, type Ports } from './session';
import type { AuthConfig } from './workos';

const SCHEME = 'ai.shamwari.app';

export function authConfig(extra: { workosClientId?: string } | undefined): AuthConfig {
  return {
    clientId: extra?.workosClientId ?? 'client_01M68PCT0T5ECHKDYH45ECT0GV',
    redirectUri: `${SCHEME}://callback`,
    logoutReturnTo: `${SCHEME}://signed-out`,
    apiBase: 'https://api.workos.com',
  };
}

/** The phone-specific half, kept thin: everything that decides anything is in session.ts and is tested without a phone. */
export function createNativeSession(cfg: AuthConfig): Session {
  const opts = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
  const ports: Ports = {
    fetch: (...a) => fetch(...a),
    secure: {
      get: (k) => SecureStore.getItemAsync(k, opts),
      set: (k, v) => SecureStore.setItemAsync(k, v, opts),
      delete: (k) => SecureStore.deleteItemAsync(k, opts),
    },
    // A system browser session (shares the phone's cookies, supports passkeys), never a WebView.
    openAuthSession: async (url, redirectUri) => {
      const r = await WebBrowser.openAuthSessionAsync(url, redirectUri);
      return r.type === 'success' ? { type: 'success', url: r.url } : { type: 'cancel' };
    },
    openUrl: async (url) => {
      await WebBrowser.openAuthSessionAsync(url, cfg.logoutReturnTo);
    },
    randomBytes: (n) => Crypto.getRandomBytes(n),
    sha256: async (s) =>
      new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new TextEncoder().encode(s))),
    now: () => Date.now(),
  };
  return new Session(cfg, ports);
}
