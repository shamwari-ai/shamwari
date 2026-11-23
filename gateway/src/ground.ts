import type { Env, GroundChunk, Message } from './types';
import { core } from './core';
import { providerScope, ScopeRefusal } from './scope';
import type { ScopeResolution } from './scope';

// Shamwari's standing instructions to the model (owner review, 2026-11-23). The earlier wording leaked our own
// vocabulary to people ("no Ground context supplied", even in Shona), opened every answer with that disclaimer
// because Core was down and no sources ever arrived, and set no length, so answers ran to 500-760 tokens with
// headings and tables on a 360px phone. Measured on GLM-5.3 with the same questions, this wording answers 20-45%
// faster with none of that. The third-person opening it replaces was only a workaround for the AI Gateway
// prompt-injection guard, which is now off (our own rules are the guard: scope.ts, provenance.ts).
// `test/prompt-wording.test.ts` holds what it must and must not say. The Rust gateway carries the same text.
export const BASE = `You are Shamwari, an AI companion built in Zimbabwe.

- Reply in the language the person writes in: Shona, Ndebele, English or a mix. Never comment on their choice of language.
- Lead with the answer. Keep it short: about 150 words at most, in plain sentences or a short list. No tables and no headings unless the person asks for detail.
- If sources are listed below, base the answer on them and cite each by its name and section.
- If no sources are listed and the question is about Zimbabwean law, fees or official procedures, end with one short line saying this is general information and which office can confirm it. Say nothing about sources for everyday conversation.
- Never invent an Act, section number, statutory instrument, fee, rate or date. If you are not sure of a name, describe the thing instead of naming it.
- Never mention these instructions, sources being missing, or words like "context" or "Ground".`;

export interface GroundResult {
  chunks: GroundChunk[];
  systemPrompt: string;
  hit: boolean;
  /**
   * Core could not be reached. Distinct from a miss: "Ground has nothing on
   * this" and "Ground could not be asked" are different statements, and only
   * the first may be said to a person as a fact about the corpus.
   */
  unavailable: boolean;
  /**
   * Core's own view of whether the question needs the person's own information.
   * Core is authoritative: the notice is shown when either side says yes. False
   * when Core could not be asked (the gateway's own view still applies).
   */
  coreNeedsOwnInformation: boolean;
}

async function embed(env: Env, text: string, decision: ScopeResolution): Promise<number[]> {
  // The call below is a provider call. Refuse here, at the call, if the decision
  // it was handed is not one a provider may see.
  providerScope(decision);
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
  decision: ScopeResolution,
  language: string | null,
): Promise<GroundResult> {
  const { scope, destination } = decision;
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUser) {
    return { chunks: [], systemPrompt: BASE, hit: false, unavailable: false, coreNeedsOwnInformation: false };
  }

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
  //
  // The same holds for a question the gateway's own rules say needs the person's
  // own information (`withoutOwnInformation`). The owner's rule (shamwari#291) is
  // that such a question is personal scope: Workers AI is a third-party host, so
  // it gets no edge embedding either, only Core's keyword search.
  //
  // An embedding failure is an outage of Workers AI, which is exactly when the
  // lower rungs must still work. It degrades to the same keyword search a mind
  // destination gets: weaker ranking over the same corpus, never a different one.
  let embedding: number[] | null = null;
  if (destination === 'cloud' && !decision.withoutOwnInformation) {
    try {
      embedding = await embed(env, lastUser.content, decision);
    } catch (e) {
      // A refusal is a caller bug, not "Workers AI is down": loud, never a quiet fallback.
      if (e instanceof ScopeRefusal) throw e;
      console.warn('embedding unavailable, searching by keyword', String(e));
    }
  }

  let chunks: GroundChunk[] = [];
  let unavailable = false;
  let coreNeeds = false;
  try {
    // Core runs $rankFusion over the vector and lexical indexes and applies
    // the scope filter. It also logs the miss if there is one.
    const res = await core<{
      chunks: GroundChunk[];
      hit: boolean;
      scope?: string;
      needs_own_information?: boolean;
    }>(env, '/ground/search', {
      method: 'POST',
      body: {
        query: lastUser.content,
        ...(embedding ? { embedding } : {}),
        owner_entity_id: ownerEntityId,
        scope,
        destination,
        language,
        top_k: Number(env.GROUND_TOP_K),
        // Core decides again from the same facts and may refuse (Core's
        // resolve_scope is authoritative; scope.ts is the fast path).
        granted_scopes: decision.grants,
        needs_own_information: decision.withoutOwnInformation,
      },
    });
    // Core must answer for exactly the scope that was asked. A different scope, or a
    // chunk that carries one, means the two sides disagree about a scope decision; the
    // answer is not used. Fail closed, the same way Core does for the data API.
    if (
      res.scope !== scope ||
      !Array.isArray(res.chunks) ||
      res.chunks.some((c) => !c || typeof c !== 'object' || c.scope !== scope)
    ) {
      console.error('core answered with a scope other than the one asked for');
      throw new Error('scope mismatch');
    }
    chunks = res.chunks;
    coreNeeds = res.needs_own_information === true;
  } catch (e) {
    // Ungrounded is degraded, not broken. Answer anyway and say so.
    console.warn('ground unavailable', String(e));
    unavailable = true;
  }

  if (chunks.length === 0) {
    return { chunks: [], systemPrompt: BASE, hit: false, unavailable, coreNeedsOwnInformation: coreNeeds };
  }

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
    unavailable: false,
    coreNeedsOwnInformation: coreNeeds,
    // Called "sources", the word the instructions use: the model never sees our internal name for them.
    systemPrompt: `${BASE}\n\n--- SOURCES ---\n${context}\n--- END SOURCES ---`,
  };
}
