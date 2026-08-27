import type { Env, Message } from './types';
import type { Target } from './router';

export interface InferenceResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  cacheHit: boolean;
  provider: string;
  model: string;
  path: 'gateway' | 'direct' | 'workers-ai';
}

async function post(
  url: string,
  headers: Record<string, string>,
  model: string,
  messages: Message[],
): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 2048 }),
  });
}

/**
 * Three-step degradation, so Cloudflare is an enhancement and not a
 * dependency:
 *   1. AI Gateway   caching, spend limits, observability
 *   2. Direct       same provider, no Cloudflare in the path
 *   3. Workers AI   last resort, lower quality, still answers
 *
 * Exercise steps 2 and 3 monthly or they will rot silently.
 */
export async function infer(
  env: Env,
  target: Target,
  messages: Message[],
): Promise<InferenceResult> {
  const key = target.apiKey(env);

  try {
    const res = await post(
      `https://gateway.ai.cloudflare.com/v1/${env.CF_ACCOUNT_ID}/${env.CF_GATEWAY_ID}/compat/chat/completions`,
      {
        'cf-aig-authorization': `Bearer ${env.CF_AIG_TOKEN}`,
        Authorization: `Bearer ${key}`,
      },
      `${target.provider}/${target.model}`,
      messages,
    );
    if (res.ok) {
      return parse(res, target, res.headers.get('cf-aig-cache-status') === 'HIT', 'gateway');
    }
    console.warn('gateway', res.status);
  } catch (e) {
    console.warn('gateway threw', String(e));
  }

  if (target.directUrl) {
    try {
      const res = await post(
        target.directUrl,
        { Authorization: `Bearer ${key}` },
        target.model,
        messages,
      );
      if (res.ok) return parse(res, target, false, 'direct');
      console.warn('direct', res.status);
    } catch (e) {
      console.warn('direct threw', String(e));
    }
  }

  const fb = (await env.AI.run('@cf/qwen/qwen2.5-coder-32b-instruct' as never, {
    messages,
  } as never)) as { response?: string };

  return {
    text: fb.response ?? 'Shamwari cannot answer right now. Please retry.',
    inputTokens: 0,
    outputTokens: 0,
    cacheHit: false,
    provider: 'workers-ai',
    model: 'fallback',
    path: 'workers-ai',
  };
}

async function parse(
  res: Response,
  target: Target,
  cacheHit: boolean,
  path: InferenceResult['path'],
): Promise<InferenceResult> {
  const j = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    text: j.choices?.[0]?.message?.content ?? '',
    inputTokens: j.usage?.prompt_tokens ?? 0,
    outputTokens: j.usage?.completion_tokens ?? 0,
    cacheHit,
    provider: target.provider,
    model: target.model,
    path,
  };
}
