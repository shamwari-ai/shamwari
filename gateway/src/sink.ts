import type { Env, SinkMessage } from './types';

/**
 * Queue consumer. Batches up to 100 and hands them to Core, which owns the
 * Mongo connection pool.
 *
 * The Atlas Data API was removed in September 2025 and the native driver is
 * not production-hardened in Workers, so the Worker never talks to Mongo.
 * A Core outage produces a queue backlog, not a failed user request.
 */
export async function drain(batch: MessageBatch<SinkMessage>, env: Env): Promise<void> {
  const byDb: Record<string, Record<string, Record<string, unknown>[]>> = {};
  for (const m of batch.messages) {
    const { database, collection, doc } = m.body;
    ((byDb[database] ??= {})[collection] ??= []).push(doc);
  }

  for (const [database, collections] of Object.entries(byDb)) {
    const res = await fetch(`${env.CORE_URL}/sink/bulk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.SHAMWARI_CORE_TOKEN}`,
      },
      body: JSON.stringify({ database, collections }),
    });
    // Throwing retries the batch. Five attempts, then the DLQ.
    if (!res.ok) throw new Error(`sink ${res.status}: ${await res.text()}`);
  }
}
