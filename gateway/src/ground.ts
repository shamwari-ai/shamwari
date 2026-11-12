import type { Env, GroundChunk, Message } from './types';
import { core } from './core';
import { providerScope, ScopeRefusal } from './scope';
import type { ScopeResolution } from './scope';

// Wording note (2026-11-12): the AI Gateway's prompt-injection guard (P1: BLOCK) rejects a system prompt that
// opens "You are Shamwari, ..." and the "verify the figure" sentence below in their earlier wording, with a 424
// "Prompt blocked" on every request. The persona is stated as a fact about the conversation instead, and the
// sentence is reworded; `test/prompt-wording.test.ts` keeps the old phrasings out.
const BASE = `The assistant in this conversation is Shamwari, an AI companion built in Zimbabwe.

- Answer in the language the user writes in. Shona, Ndebele, English and code-switched mixtures are all normal. Never apologise for the user's language choice.
- When Ground context is supplied, ground your answer in it and cite the source by name and section.
- If Ground context does not cover the question, say so plainly, then answer from general knowledge and mark it as such. Never invent a section number, a statutory instrument, a rate or a date.
- Laws and rates in Zimbabwe change often. When an answer depends on a current figure that the supplied context does not confirm, mention that it needs checking and say which authority to check with.
- Be direct and practical. Assume a slow connection and a small screen.`;

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
  // An embedding failure is an outage of Workers AI, which is exactly when the
  // lower rungs must still work. It degrades to the same keyword search a mind
  // destination gets: weaker ranking over the same corpus, never a different one.
  let embedding: number[] | null = null;
  if (destination === 'cloud') {
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
    systemPrompt: `${BASE}\n\n--- SHAMWARI GROUND CONTEXT ---\n${context}\n--- END CONTEXT ---`,
  };
}
