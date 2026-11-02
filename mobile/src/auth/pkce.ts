/**
 * PKCE (RFC 7636) for a public client. The phone holds no secret, so a code
 * intercepted on the redirect is useless without the verifier, and the verifier
 * never leaves the app until the token exchange.
 */
export type Sha256 = (input: string) => Promise<Uint8Array>;
export type RandomBytes = (n: number) => Uint8Array;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** base64url without padding. Written out so it runs the same on Hermes and in tests. */
export function base64url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += ALPHABET[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += ALPHABET[n & 63];
  }
  return out;
}

export function base64urlDecode(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9\-_]/g, '');
  const out: number[] = [];
  let bits = 0;
  let acc = 0;
  for (const ch of clean) {
    acc = (acc << 6) | ALPHABET.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((acc >> bits) & 255);
      acc &= (1 << bits) - 1;
    }
  }
  return Uint8Array.from(out);
}

/** UTF-8 decode without TextDecoder (not guaranteed on every Hermes build). */
export function utf8Decode(bytes: Uint8Array): string {
  let pct = '';
  for (const b of bytes) pct += '%' + b.toString(16).padStart(2, '0');
  return decodeURIComponent(pct);
}

/** ASCII bytes of a string (the PKCE verifier is base64url, so ASCII), without TextEncoder. */
export const asciiBytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 255);

export async function challengeFor(verifier: string, sha256: Sha256): Promise<string> {
  return base64url(await sha256(verifier));
}

export interface Pkce {
  verifier: string;
  challenge: string;
  state: string;
}

/** 64 random bytes -> an 86 character verifier (RFC 7636 allows 43 to 128); 32 for the state. */
export async function newPkce(random: RandomBytes, sha256: Sha256): Promise<Pkce> {
  const verifier = base64url(random(64));
  return { verifier, challenge: await challengeFor(verifier, sha256), state: base64url(random(32)) };
}

/** Constant-time string compare, for the state check. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
