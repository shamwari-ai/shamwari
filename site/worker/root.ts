/**
 * The apex root. https://shamwari.ai/ sends a signed-in person to the chat at /chat/ with a plain 302 and no JavaScript,
 * so it is instant on a slow link and works with scripts off. (Signed-out visitors never get here: worker/index.ts sends
 * them to sign-in first.)
 *
 * Until 2026-11-18 it chose between a main chat at /chat/ and the light chat at /lite/ by connection quality. There is one
 * chat now, this app, at /chat/ (owner decision, 2026-11-18, docs/chat-app.md), so there is nothing left to choose.
 */
export const CHAT = '/chat/';

export function rootResponse(req: Request): Response {
  // GET and HEAD only: a link checker's HEAD gets the same answer, anything else is refused.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } });
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: CHAT,
      // Never cached: whether this visitor is signed in decides between this answer and sign-in (worker/index.ts).
      'Cache-Control': 'no-store',
      Vary: 'Cookie',
    },
  });
}
