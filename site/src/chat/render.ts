import type { Strings } from './strings';
import type { StoredMessage } from './store';
import type { Answer, AskErrorKind, Citation, Language, Scope } from './types';

/**
 * Everything here builds DOM with createElement and textContent, never
 * innerHTML: answers and Ground passages are untrusted text and must not be
 * able to inject markup.
 */
type Child = Node | string | null | false | undefined;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c) el.append(c);
  return el;
}

const LOCALES: Record<Language, string[]> = { en: ['en-GB'], sn: ['sn', 'en-GB'], nd: ['nd', 'en-GB'] };

/** "22 May 2013". Falls back to the ISO date where the browser lacks the locale. */
export function formatDate(iso: string, lang: Language): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  for (const locale of LOCALES[lang]) {
    try {
      return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d);
    } catch {
      /* try the next locale */
    }
  }
  return iso.slice(0, 10);
}

export function renderCitation(c: Citation, s: Strings, lang: Language): HTMLElement {
  const meta = [c.authority, c.effective_from ? `${s.effective} ${formatDate(c.effective_from, lang)}` : '']
    .filter(Boolean)
    .join(' · ');
  return h(
    'li',
    { class: 'cite' },
    h('span', { class: 'badge', title: s.groundHint }, s.ground),
    c.heading ? h('strong', { class: 'cite-heading' }, c.heading) : null,
    h('span', { class: 'cite-title' }, c.title),
    meta ? h('span', { class: 'cite-meta' }, meta) : null,
    c.url
      ? h('a', { class: 'cite-link', href: c.url, target: '_blank', rel: 'noopener noreferrer' }, s.openSource)
      : null,
  );
}

export function renderAnswer(m: StoredMessage, a: Answer, s: Strings, lang: Language): HTMLElement {
  return h(
    'article',
    { class: 'msg bot', 'data-id': m.id, 'aria-label': s.shamwari },
    h('p', { class: 'who' }, s.shamwari),
    h('p', { class: 'text' }, a.text),
    a.degraded ? h('p', { class: 'note' }, s.closestSource) : null,
    a.citations.length
      ? h(
          'section',
          { class: 'sources', 'aria-label': s.sources },
          h('h2', {}, s.sources),
          h('ul', {}, ...a.citations.map((c) => renderCitation(c, s, lang))),
        )
      : h('p', { class: 'note' }, s.noSources),
    h('p', { class: 'meta' }, `${s.scopeLabel}: ${s.scope[a.scope]}`),
  );
}

export interface QueueActions {
  sendNow(): void;
  discard(): void;
}

export function renderUser(m: StoredMessage, s: Strings, queue?: QueueActions): HTMLElement {
  const el = h(
    'article',
    { class: 'msg user', 'data-id': m.id, 'aria-label': s.you },
    h('p', { class: 'who' }, s.you),
    h('p', { class: 'text' }, m.text),
  );
  updateUser(el, m, s, queue);
  return el;
}

/**
 * Change a question's "waiting to send" state IN PLACE. Replacing the node would
 * count as a new addition to the aria-live log and the screen reader would read
 * the person's own question out again, in the middle of the answer.
 */
export function updateUser(el: HTMLElement, m: StoredMessage, s: Strings, queue?: QueueActions): void {
  el.querySelector('.queue-extra')?.remove();
  el.classList.toggle('queued', m.status === 'queued');
  if (m.status !== 'queued') return;
  // A status, not an alert: waiting to send is the app working as designed.
  // Say the real reason: a brief outage is not "no connection", and the person
  // should hear that the question is kept and will be tried again.
  const why = m.hint === 'unavailable' ? s.errors.unavailable : m.hint === 'busy' ? s.errors.busy : s.offlineQueued;
  const extra = h('div', { class: 'queue-extra' }, h('p', { class: 'note', role: 'status' }, why));
  if (queue) {
    const now = h('button', { type: 'button', class: 'btn' }, s.sendNow);
    const drop = h('button', { type: 'button', class: 'btn' }, s.discard);
    now.addEventListener('click', queue.sendNow);
    drop.addEventListener('click', queue.discard);
    extra.append(h('div', { class: 'row' }, now, drop));
  }
  el.append(extra);
}

export function renderPending(id: string, s: Strings): HTMLElement {
  return h(
    'article',
    { class: 'msg bot pending', 'data-id': `${id}:pending`, 'aria-label': s.shamwari },
    // The role sits on a div, not the article: an article may not carry it.
    h(
      'div',
      { role: 'status' },
      h('p', { class: 'who' }, s.shamwari),
      h('p', { class: 'text' }, s.thinking, h('span', { class: 'dots', 'aria-hidden': 'true' }, ' ●●●')),
    ),
  );
}

const RETRYABLE: AskErrorKind[] = ['offline', 'unavailable', 'busy', 'rate_limited', 'unknown'];

export interface ErrorActions {
  retry(): void;
  askGeneral(): void;
  signIn(): void;
}

/** The kind explanation for the personal-scope 409: the product working, not breaking. */
export function renderScopeRefusal(id: string, s: Strings, actions: ErrorActions): HTMLElement {
  const ask = h('button', { type: 'button', class: 'btn' }, s.scopePersonalAction);
  ask.addEventListener('click', actions.askGeneral);
  return h(
    'article',
    { class: 'msg bot refusal', 'data-id': `${id}:error`, 'aria-label': s.shamwari },
    h(
      'div',
      { role: 'status' },
      h('p', { class: 'who' }, s.shamwari),
      h('h2', {}, s.scopePersonalTitle),
      h('p', { class: 'text' }, s.scopePersonalBody),
    ),
    ask,
  );
}

export function renderError(
  id: string,
  e: NonNullable<StoredMessage['error']>,
  s: Strings,
  actions: ErrorActions,
): HTMLElement {
  if (e.kind === 'scope_requires_local_inference') return renderScopeRefusal(id, s, actions);
  const el = h(
    'article',
    { class: 'msg bot error', 'data-id': `${id}:error`, 'aria-label': s.shamwari },
    h(
      'div',
      { role: 'alert' },
      h('p', { class: 'who' }, s.shamwari),
      h('p', { class: 'text' }, s.errors[e.kind as keyof Strings['errors']] ?? s.errors.unknown),
      e.retryAfterSec ? h('p', { class: 'note' }, `${s.retryIn} ${e.retryAfterSec} ${s.seconds}.`) : null,
    ),
  );
  if (e.upgradeUrl && (e.kind === 'payment_required' || e.kind === 'rate_limited')) {
    el.append(h('a', { class: 'btn', href: e.upgradeUrl, target: '_blank', rel: 'noopener noreferrer' }, s.upgrade));
  }
  if (e.kind === 'unauthorized') {
    const b = h('button', { type: 'button', class: 'btn primary' }, s.authTitle);
    b.addEventListener('click', actions.signIn);
    el.append(b);
  } else if (RETRYABLE.includes(e.kind)) {
    const b = h('button', { type: 'button', class: 'btn' }, s.retry);
    b.addEventListener('click', actions.retry);
    el.append(b);
  }
  return el;
}

export const SCOPES: Scope[] = ['platform', 'community', 'personal'];
