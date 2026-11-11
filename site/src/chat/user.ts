/**
 * Who the messages on this device belong to. A Mukoko sign-in names a person (the access token's `sub`); their chats are
 * kept in a store of their own, so signing out can leave them on the device (the default) without the next person who
 * signs in reading them. This is a separation, NOT encryption: anyone who can open this browser's site data can read
 * every person's store. The sign-out dialog says so.
 *
 * What is kept in localStorage is a short hash of the `sub`, never the `sub` or a token. It names a database; it is not a
 * credential.
 */
export const USER_KEY = 'shamwari.mukoko.user';
const HINT = 'shamwari.mukoko.hint';

/** The `sub` of an access token, or null. The token is not verified here (the gateway does that); it only names a store. */
export function subjectOf(token: string | null | undefined): string | null {
  if (!token) return null;
  try {
    const seg = token.split('.')[1] ?? '';
    const json = atob(seg.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(seg.length / 4) * 4, '='));
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === 'string' && sub ? sub : null;
  } catch {
    return null;
  }
}

/** A stable, non-reversible-at-a-glance name for one person's store: 24 hex characters of SHA-256 over the `sub`. */
export async function userKeyOf(sub: string): Promise<string> {
  const bytes = new TextEncoder().encode(`shamwari:user:${sub}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** The store key remembered for a device that is signed in (the hint is set), else null: a signed-out device uses none. */
export function readStoredUser(): string | null {
  try {
    if (localStorage.getItem(HINT) !== '1') return null;
    const k = localStorage.getItem(USER_KEY);
    return k && /^[0-9a-f]{24}$/.test(k) ? k : null;
  } catch {
    return null;
  }
}

export function rememberUser(key: string | null): void {
  try {
    if (key) localStorage.setItem(USER_KEY, key);
    else localStorage.removeItem(USER_KEY);
  } catch {
    /* no storage: the store is chosen again from the next token */
  }
}
