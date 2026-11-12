/**
 * The apex root. https://shamwari.ai/ sends a person to the main chat (/chat/) or the light
 * chat (/lite/) depending on how good their connection looks, with a plain 302 and no
 * JavaScript, so it is instant on a slow link and works with scripts off.
 *
 * What the server can see, in order:
 *  - `Save-Data: on` (the person asked their phone to save data): light.
 *  - The network client hints `ECT`, `Downlink` and `RTT`, which Chromium sends once the first
 *    answer asks for them (`Accept-CH` + `Critical-CH`, so it retries by itself). A connection
 *    that is not 4g, under 8 Mbps, or over 100 ms round trip: light. Browsers report 4g as the
 *    best class, so "better than 4g" is only visible as these numbers, not as a label.
 *  - Cloudflare's own measurement of the round trip to the visitor (`cf.clientTcpRtt`), for
 *    browsers that send no hints (Safari, Firefox).
 *  - Nothing at all: light. A slow link pays for a heavy page far more than a fast one loses
 *    by getting the light one, so "unknown" is not a reason to send anyone to the big app.
 *
 * (Signed-out visitors never get here: worker/index.ts sends them to sign-in first.)
 *
 * Until the main chat is live (`CHAT_LIVE`), everyone goes to /lite/: the root must never send a
 * visitor to a page that does not exist yet.
 */
export const CHAT = '/chat/';
export const LITE = '/lite/';

/** Chromium caps the Downlink hint at 10 Mbps, so this sits just under the cap: a fast link whose
 *  estimate wobbles still passes, a typical 4g link (a few Mbps) does not. */
export const FAST_DOWNLINK_MBPS = 8;
export const FAST_RTT_MS = 100;
/** Cloudflare measures the TCP handshake, which runs a little above the browser's RTT. */
export const FAST_TCP_RTT_MS = 150;

interface CfLike {
  clientTcpRtt?: number;
}

const num = (v: string | null): number | null => {
  if (v === null || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function chooseDestination(req: Request, chatLive: boolean): string {
  if (!chatLive) return LITE;
  const h = req.headers;
  if (h.get('Save-Data')?.toLowerCase() === 'on') return LITE;

  const ect = h.get('ECT')?.toLowerCase() ?? null;
  const downlink = num(h.get('Downlink'));
  const rtt = num(h.get('RTT'));

  // Any signal that is present and slow settles it: light.
  if (ect !== null && ect !== '4g') return LITE; // slow-2g, 2g or 3g
  if (downlink !== null && downlink < FAST_DOWNLINK_MBPS) return LITE;
  if (rtt !== null && rtt > FAST_RTT_MS) return LITE;
  // Hints can only say "fast" when they are all here. A partial set (a privacy setting that
  // withholds one) is not evidence of speed, so it falls through to the measurement below.
  if (ect === '4g' && downlink !== null) return CHAT;

  // No usable hints (Safari, Firefox, or the first request before Chromium has sent any): the
  // round trip Cloudflare measured. Zero is not a measurement: over HTTP/3 there is no TCP
  // handshake to time, so it must not read as "very fast".
  const tcp = (req as Request & { cf?: CfLike }).cf?.clientTcpRtt;
  if (typeof tcp === 'number' && tcp > 0 && tcp <= FAST_TCP_RTT_MS) return CHAT;
  return LITE;
}

export function rootResponse(req: Request, chatLive: boolean): Response {
  // GET and HEAD only: a link checker's HEAD gets the same answer, anything else is refused.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' } });
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: chooseDestination(req, chatLive),
      // Never cached: the answer depends on this visitor's connection, today.
      'Cache-Control': 'no-store',
      Vary: 'Save-Data, ECT, Downlink, RTT, Cookie',
      // Ask Chromium for the connection hints and have it repeat the request with them once.
      'Accept-CH': 'ECT, Downlink, RTT',
      'Critical-CH': 'ECT, Downlink, RTT',
    },
  });
}
