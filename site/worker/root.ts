/**
 * The apex root. https://shamwari.ai/ sends a person to the main chat (/chat/) or the light
 * chat (/lite/) depending on how good their connection looks, with a plain 302 and no
 * JavaScript, so it is instant on a slow link and works with scripts off.
 *
 * What the server can see, in order:
 *  - `Save-Data: on` (the person asked their phone to save data): light.
 *  - The network client hints `ECT`, `Downlink` and `RTT`, which Chromium sends once the first
 *    answer asks for them (`Accept-CH` + `Critical-CH`, so it retries by itself). A connection
 *    that is not 4g, under 10 Mbps, or over 100 ms round trip: light. Browsers report 4g as the
 *    best class, so "better than 4g" is only visible as these numbers, not as a label.
 *  - Cloudflare's own measurement of the round trip to the visitor (`cf.clientTcpRtt`), for
 *    browsers that send no hints (Safari, Firefox).
 *  - Nothing at all: light. A slow link pays for a heavy page far more than a fast one loses
 *    by getting the light one, so "unknown" is not a reason to send anyone to the big app.
 *
 * Until the main chat is live (`CHAT_LIVE`), everyone goes to /lite/: the root must never send a
 * visitor to a page that does not exist yet.
 */
export const CHAT = '/chat/';
export const LITE = '/lite/';

export const FAST_DOWNLINK_MBPS = 10;
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
  if (ect !== null || downlink !== null || rtt !== null) {
    if (ect !== '4g') return LITE; // slow-2g, 2g, 3g, or a hint set that left it out
    if (downlink === null || downlink < FAST_DOWNLINK_MBPS) return LITE;
    if (rtt !== null && rtt > FAST_RTT_MS) return LITE;
    return CHAT;
  }

  const tcp = (req as Request & { cf?: CfLike }).cf?.clientTcpRtt;
  if (typeof tcp === 'number' && tcp <= FAST_TCP_RTT_MS) return CHAT;
  return LITE;
}

export function rootResponse(req: Request, chatLive: boolean): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: chooseDestination(req, chatLive),
      // Never cached: the answer depends on this visitor's connection, today.
      'Cache-Control': 'no-store',
      Vary: 'Save-Data, ECT, Downlink, RTT',
      // Ask Chromium for the connection hints and have it repeat the request with them once.
      'Accept-CH': 'ECT, Downlink, RTT',
      'Critical-CH': 'ECT, Downlink, RTT',
    },
  });
}
