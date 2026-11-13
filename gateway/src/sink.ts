import type { Env, SinkMessage } from './types';

/**
 * Queue consumer. Batches up to 100 and hands them to Core, which owns the
 * data-layer connection (the Servers API over the private network). The Worker
 * holds no Servers API key or token.
 *
 * The Atlas Data API was removed in September 2025 and the native driver is
 * not production-hardened in Workers, so the Worker never talks to Mongo.
 * A Core outage produces a queue backlog, not a failed user request.
 *
 * Two kinds of failure, treated differently:
 *
 *  - Transient (a 5xx, 429, a refused credential, a missing route, or no answer at
 *    all): throw. The queue retries whatever has not been acknowledged, five times,
 *    then the DLQ. Nothing is lost, and a Core outage becomes a backlog.
 *  - Permanent (400, 409, 413, 422: a poison or conflicting document): retrying cannot
 *    help, and sending the whole batch of up to 100 to the DLQ would park 99 good
 *    documents with it. The batch is split in half until the bad document is alone;
 *    the good ones are stored and acknowledged, and the bad one is acknowledged too,
 *    after logging its identifiers. There is no queue binding to park it elsewhere, so
 *    it is dropped and the log line is the record.
 *  - If EVERY document in a batch of more than one is refused, that is a fault (a
 *    Core/API mismatch), not poison. Nothing is dropped: it throws, so the batch is
 *    retried and then reaches the DLQ as it always did.
 */

/** Statuses that mean "this document is wrong", not "the service is down". */
const PERMANENT = new Set([400, 409, 413, 422]);

type Msg = Message<SinkMessage>;
type Entry = { msg: Msg; collection: string; doc: Record<string, unknown> };

/** Only a plain identifier is ever logged; anything else (content, a hostile id) is not. */
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const safe = (v: unknown): string => (typeof v === 'string' && SAFE_ID.test(v) ? v : 'unknown');

/** Core relays the Servers API's RFC 9457 `error` member as `detail.error` (or `error`). */
function errorCode(text: string): string {
  try {
    const body = JSON.parse(text) as { error?: unknown; detail?: { error?: unknown } };
    return safe(body?.detail?.error ?? body?.error);
  } catch {
    return 'unknown';
  }
}

export async function drain(batch: MessageBatch<SinkMessage>, env: Env): Promise<void> {
  const byDb: Record<string, Entry[]> = {};
  for (const msg of batch.messages) {
    const { database, collection, doc } = msg.body;
    (byDb[database] ??= []).push({ msg, collection, doc });
  }

  for (const [database, entries] of Object.entries(byDb)) {
    const parked: Parked[] = [];
    await send(database, entries, env, parked);
    if (parked.length === 0) continue;
    if (parked.length === entries.length && entries.length > 1) {
      throw new Error(`sink ${parked[0]!.status}: every document in the batch was refused`);
    }
    for (const p of parked) {
      // Identifiers only: never the document, a message body or the response text.
      console.error(
        `sink parked a document: status=${p.status} error=${p.error} collection=${safe(p.entry.collection)} requestId=${safe(p.entry.doc.requestId)}`,
      );
      p.entry.msg.ack();
    }
  }
}

type Parked = { entry: Entry; status: number; error: string };

/** Stores what it can, acknowledging as it goes; collects permanently refused documents. */
async function send(database: string, entries: Entry[], env: Env, parked: Parked[]): Promise<void> {
  if (entries.length === 0) return;
  const collections: Record<string, Record<string, unknown>[]> = {};
  for (const e of entries) (collections[e.collection] ??= []).push(e.doc);

  const res = await fetch(`${env.CORE_URL}/sink/bulk`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.SHAMWARI_CORE_TOKEN}`,
    },
    body: JSON.stringify({ database, collections }),
  });

  if (res.ok) {
    for (const e of entries) e.msg.ack();
    return;
  }

  const text = await res.text();
  if (!PERMANENT.has(res.status)) {
    // Throwing retries every message not yet acknowledged. Five attempts, then the DLQ.
    throw new Error(`sink ${res.status}: ${text}`);
  }

  if (entries.length === 1) {
    parked.push({ entry: entries[0] as Entry, status: res.status, error: errorCode(text) });
    return;
  }

  const mid = Math.ceil(entries.length / 2);
  await send(database, entries.slice(0, mid), env, parked);
  await send(database, entries.slice(mid), env, parked);
}
