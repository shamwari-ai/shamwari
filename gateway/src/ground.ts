import type { Env, GroundChunk, Message, Scope } from './types';
import { core } from './core';

const BASE = `You are Shamwari, an AI companion built in Zimbabwe.

- Answer in the language the user writes in. Shona, Ndebele, English and code-switched mixtures are all normal. Never apologise for the user's language choice.
- When Ground context is supplied, ground your answer in it and cite the source by name and section.
- If Ground context does not cover the question, say so plainly, then answer from general knowledge and mark it as such. Never invent a section number, a statutory instrument, a rate or a date.
- Zimbabwean law and rates change often. Where an answer turns on a current figure you cannot confirm from Ground, say the figure must be verified and name the authority to verify it with.
- Be direct and practical. Assume a slow connection and a small screen.`;

export interface GroundResult {
  chunks: GroundChunk[];
  systemPrompt: string;
  hit: boolean;
}

async function embed(env: Env, text: string): Promise<number[]> {
  const out = (await env.AI.run(env.EMBEDDING_MODEL as never, { text: [text] } as never)) as {
    data?: number[][];
  };
  const v = out.data?.[0];
  if (!v) throw new Error('embedding failed');
  return v;
}

export async function ground(
  env: Env,
  messages: Message[],
  ownerEntityId: string,
  scope: Scope,
  destination: 'cloud' | 'mind',
  language: string | null,
): Promise<GroundResult> {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUser) return { chunks: [], systemPrompt: BASE, hit: false };

  // RULE 1, IN THE LEAK PATH.
  //
  // Embedding is inference. `env.AI.run` is a Cloudflare-hosted model, so
  // embedding a personal-scope question here would put the user's own words
  // through a third-party provider — upstream of Core's authoritative check,
  // which is the one place designed to catch exactly this.
  //
  // A `mind` destination therefore gets no edge embedding. Core falls back
  // to lexical-only retrieval, which is weaker ranking over the same public
  // corpus rather than a different corpus. Mind supplies its own vector,
  // computed on the device, when it ships.
  //
  // The question text still reaches Core. That is first-party Nyuchi
  // infrastructure, not a third-party inference provider, and Core already
  // stores the conversation — so this adds no exposure that rule 1 has not
  // already accepted.
  const embedding = destination === 'cloud' ? await embed(env, lastUser.content) : null;

  let chunks: GroundChunk[] = [];
  try {
    // Core runs $rankFusion over the vector and lexical indexes and applies
    // the scope filter. It also logs the miss if there is one.
    const res = await core<{ chunks: GroundChunk[]; hit: boolean }>(env, '/ground/search', {
      method: 'POST',
      body: {
        query: lastUser.content,
        ...(embedding ? { embedding } : {}),
        owner_entity_id: ownerEntityId,
        scope,
        destination,
        language,
        top_k: Number(env.GROUND_TOP_K),
      },
    });
    chunks = res.chunks;
  } catch (e) {
    // Ungrounded is degraded, not broken. Answer anyway and say so.
    console.warn('ground unavailable', String(e));
  }

  if (chunks.length === 0) return { chunks: [], systemPrompt: BASE, hit: false };

  const context = chunks
    .map((c, i) => {
      const cite = [c.title, c.heading, c.authority].filter(Boolean).join(' — ');
      const eff = c.effective_from ? ` (effective ${c.effective_from})` : '';
      return `[${i + 1}] ${cite}${eff}\n${c.content}`;
    })
    .join('\n\n');

  return {
    chunks,
    hit: true,
    systemPrompt: `${BASE}\n\n--- SHAMWARI GROUND CONTEXT ---\n${context}\n--- END CONTEXT ---`,
  };
}
