import { describe, expect, it } from 'vitest';
import worker from '../../worker/index';
import { CHAT, LITE, chooseDestination, rootResponse } from '../../worker/root';

const get = (headers: Record<string, string> = {}, cf?: { clientTcpRtt?: number }) => {
  const r = new Request('https://shamwari.ai/', { headers });
  if (cf) Object.defineProperty(r, 'cf', { value: cf });
  return r;
};

describe('the root before the main chat is live', () => {
  it('sends everyone to the light chat, however good the connection', () => {
    expect(chooseDestination(get({ ECT: '4g', Downlink: '10', RTT: '20' }), false)).toBe(LITE);
    expect(chooseDestination(get(), false)).toBe(LITE);
  });
});

describe('the root once the main chat is live', () => {
  it('sends a fast connection to the main chat', () => {
    expect(chooseDestination(get({ ECT: '4g', Downlink: '9.8', RTT: '50' }), true)).toBe(CHAT);
  });

  it('sends data saver, slow classes, a thin pipe or a long round trip to the light chat', () => {
    expect(chooseDestination(get({ 'Save-Data': 'on', ECT: '4g', Downlink: '10', RTT: '20' }), true)).toBe(LITE);
    for (const ect of ['slow-2g', '2g', '3g']) expect(chooseDestination(get({ ECT: ect, Downlink: '10', RTT: '20' }), true)).toBe(LITE);
    expect(chooseDestination(get({ ECT: '4g', Downlink: '4.2', RTT: '60' }), true)).toBe(LITE);
    expect(chooseDestination(get({ ECT: '4g', Downlink: '10', RTT: '180' }), true)).toBe(LITE);
  });

  it('puts the threshold just under the 10 Mbps cap Chromium reports', () => {
    expect(chooseDestination(get({ ECT: '4g', Downlink: '8', RTT: '40' }), true)).toBe(CHAT);
    expect(chooseDestination(get({ ECT: '4g', Downlink: '7.9', RTT: '40' }), true)).toBe(LITE);
  });

  it('does not take a partial hint set as proof of speed, but still uses what is slow in it', () => {
    expect(chooseDestination(get({ Downlink: '10' }), true)).toBe(LITE); // no ECT, nothing else known
    expect(chooseDestination(get({ ECT: '4g' }), true)).toBe(LITE); // no downlink
    expect(chooseDestination(get({ ECT: '4g', Downlink: 'fast' }), true)).toBe(LITE); // not a number
    expect(chooseDestination(get({ ECT: '3g' }, { clientTcpRtt: 20 }), true)).toBe(LITE); // slow beats the measurement
    // A partial set falls through to Cloudflare's measurement instead of being a dead end.
    expect(chooseDestination(get({ ECT: '4g' }, { clientTcpRtt: 40 }), true)).toBe(CHAT);
  });

  it('falls back to Cloudflare’s round trip measurement when the browser sends no hints', () => {
    expect(chooseDestination(get({}, { clientTcpRtt: 40 }), true)).toBe(CHAT);
    expect(chooseDestination(get({}, { clientTcpRtt: 400 }), true)).toBe(LITE);
  });

  it('does not read a zero round trip (HTTP/3 has no TCP handshake) as very fast', () => {
    expect(chooseDestination(get({}, { clientTcpRtt: 0 }), true)).toBe(LITE);
    expect(chooseDestination(get({}, { clientTcpRtt: Number.NaN }), true)).toBe(LITE);
  });

  it('sends a visitor it knows nothing about to the light chat', () => {
    expect(chooseDestination(get(), true)).toBe(LITE);
  });
});

describe('the root answer', () => {
  it('is a 302 that is never cached and asks the browser for its connection hints', () => {
    const res = rootResponse(get({ ECT: '4g', Downlink: '10', RTT: '50' }), true);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(CHAT);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Vary')).toBe('Save-Data, ECT, Downlink, RTT');
    expect(res.headers.get('Accept-CH')).toBe('ECT, Downlink, RTT');
    expect(res.headers.get('Critical-CH')).toBe('ECT, Downlink, RTT');
  });
});

describe('the Worker', () => {
  const ctx = { waitUntil: () => {} };

  it('answers the root with no secrets bound, which sign-in cannot do', async () => {
    const res = await worker.fetch(get(), {}, ctx);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(LITE);
    // Sign-in with nothing configured is still a 503 or a kind redirect, not the root's business.
    const login = await worker.fetch(new Request('https://shamwari.ai/lite/auth/login'), {}, ctx);
    expect(login.status).toBe(302);
    expect(login.headers.get('Location')).toBe('/lite/?signin=failed');
  });

  it('only CHAT_LIVE="true" turns the main chat on', async () => {
    const fast = { ECT: '4g', Downlink: '10', RTT: '30' };
    expect((await worker.fetch(get(fast), { CHAT_LIVE: 'true' }, ctx)).headers.get('Location')).toBe(CHAT);
    for (const v of [undefined, 'false', 'TRUE', '1', '']) {
      expect((await worker.fetch(get(fast), { CHAT_LIVE: v }, ctx)).headers.get('Location'), String(v)).toBe(LITE);
    }
  });

  it('answers HEAD like GET, and refuses other methods without reaching sign-in', async () => {
    const head = await worker.fetch(new Request('https://shamwari.ai/', { method: 'HEAD' }), {}, ctx);
    expect(head.status).toBe(302);
    expect(head.headers.get('Location')).toBe(LITE);
    for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
      const res = await worker.fetch(new Request('https://shamwari.ai/', { method }), {}, ctx);
      expect(res.status, method).toBe(405);
      expect(res.headers.get('Allow'), method).toBe('GET, HEAD');
    }
  });
});
