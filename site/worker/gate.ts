import { SESSION_COOKIE, readCookie, type CheckResult } from './session';

/**
 * The gate in front of the light chat.
 *
 * Nothing under /lite/ (and none of the app's scripts) is served to someone with no session. An
 * unauthenticated request for the page goes straight to the AuthKit hosted sign-in
 * (/lite/auth/login); it never sees a shell with a login button on it.
 *
 * PUBLIC is the whole list of what is served without a session, and nothing else is. Each entry
 * holds no app content and no messages:
 *  - the privacy statement (it has to be readable before someone agrees to sign in),
 *  - the web app manifest, the three install icons and the service worker (installability),
 *  - the two icons the pages link to, and the stylesheets the privacy page is drawn with.
 * The app's HTML shell and its scripts are NOT here. test/worker/gate.test.ts fails if this list
 * changes without that test changing with it.
 *
 * What this does NOT cover, on purpose: a device that has signed in has the service worker, and the service
 * worker answers /lite/ from its cache so the chat opens with no network (offline mode). On that device the
 * shell is shown without asking this Worker; the page then asks /lite/auth/token and a 401 means the session
 * is over. Sending that case to sign-in (instead of showing the in-page sign-in) is a client change that comes
 * after the drawer and sign-in changes in #188. The service worker's own install and update also need a
 * session, because they fetch the gated shell: while signed out an update fails and the old worker stays.
 */
export const PUBLIC_EXACT: readonly string[] = [
  '/lite/disclaimer',
  '/lite/disclaimer/',
  '/lite/manifest.webmanifest',
  '/lite/sw.js',
  '/lite/icons/icon-192.png',
  '/lite/icons/icon-512.png',
  '/lite/icons/maskable-512.png',
];
/** Build output stylesheets: /_astro/<name>.<hash>.css and nothing else under /_astro/. */
const PUBLIC_STYLESHEET = /^\/_astro\/[A-Za-z0-9._-]+\.css$/;

export const isPublic = (pathname: string): boolean => PUBLIC_EXACT.includes(pathname) || PUBLIC_STYLESHEET.test(pathname);

/** Everything this Worker gates: the light chat and the build output its page loads. */
export const isGated = (pathname: string): boolean => pathname.startsWith('/lite/') || pathname.startsWith('/_astro/');

/** Build output, named by content hash: /_astro/<name>.<hash>.<ext>. */
const HASHED = /^\/_astro\/[A-Za-z0-9._-]+\.[A-Za-z0-9_-]{6,}\.(js|css)$/;

const SHELL = new Set(['/lite/', '/lite/index.html']);

export interface GateDeps {
  /** Unseal the session cookie and say whether it is a session. */
  check(sealed: string): Promise<CheckResult>;
  /** The static asset for this request (the Workers `ASSETS` binding). */
  asset(req: Request): Promise<Response>;
}

const noStore = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
/** The failure page is not served by the static assets, so it carries its own policy: it loads and runs nothing. */
const pageOnly = { 'Content-Security-Policy': "default-src 'none'; base-uri 'none'; form-action 'none'", 'Content-Language': 'en' };

const clearSession = `${SESSION_COOKIE}=; Path=/lite/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

/** What a failed sign-in shows. It is not the app, and it does not redirect back into sign-in (that would loop). */
const FAILED_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign-in failed</title></head><body><main><h1>We could not sign you in</h1><p>Please try again.</p><p><a href="/lite/auth/login">Try again</a></p></main></body></html>`;

export function failedPage(status = 401): Response {
  return new Response(FAILED_PAGE, {
    status,
    headers: { ...noStore, ...pageOnly, 'Content-Type': 'text/html; charset=utf-8' },
  });
}

/** 503 for when the gate cannot decide (secrets not bound, WorkOS unreachable). It fails closed: the page is not served. */
export function unavailable(): Response {
  return new Response('Sign-in is unavailable. Please try again shortly.', {
    status: 503,
    headers: { ...noStore, 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '30' },
  });
}

export async function gate(req: Request, deps: GateDeps): Promise<Response> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { ...noStore, Allow: 'GET, HEAD' } });
  }
  const url = new URL(req.url);
  if (isPublic(url.pathname)) return deps.asset(req);

  const denied = (clear: boolean): Response => {
    const headers = new Headers(noStore);
    if (clear) headers.append('Set-Cookie', clearSession);
    // The page goes to sign-in. A script, or anything else, is simply refused: redirecting a
    // subresource to an HTML page would only be a confusing error. A page that arrives here with
    // the failure marker stops, rather than being sent round the same loop again.
    if (SHELL.has(url.pathname) && url.searchParams.get('signin') !== 'failed') {
      headers.set('Location', '/lite/auth/login');
      return new Response(null, { status: 302, headers });
    }
    if (SHELL.has(url.pathname)) {
      const res = failedPage();
      if (clear) res.headers.append('Set-Cookie', clearSession);
      return res;
    }
    return new Response('Sign in to continue.', { status: 401, headers });
  };

  const sealed = readCookie(req, SESSION_COOKIE);
  if (!sealed) return denied(false);

  let checked: CheckResult;
  try {
    checked = await deps.check(sealed);
  } catch {
    return unavailable();
  }
  if (checked.status === 'invalid') return denied(true);
  if (checked.status === 'unavailable') return unavailable();

  // 'valid' or 'expired': there is a session. An expired access token is renewed by /lite/auth/token
  // when the page asks for it, so it is not a reason to turn the page away.
  const res = await deps.asset(req);
  const out = new Response(res.body, res);
  // Never kept by a shared cache. The page is revalidated every time; a build-output file has a content hash in
  // its name, so the browser may keep it for good (the policy _headers sets for /_astro/, minus `public`).
  out.headers.set(
    'Cache-Control',
    HASHED.test(url.pathname) ? 'private, max-age=31536000, immutable' : 'private, no-cache',
  );
  out.headers.append('Vary', 'Cookie');
  return out;
}
