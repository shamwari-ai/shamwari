import type { Strings } from './strings';
import type { AttachmentMeta, StoredMessage } from './store';
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

export const sizeLabel = (n: number): string => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export function renderCitation(c: Citation, s: Strings, lang: Language): HTMLElement {
  const meta = [c.authority, c.effective_from ? `${s.effective} ${formatDate(c.effective_from, lang)}` : '']
    .filter(Boolean)
    .join(' · ');
  // One compact row: the Ground badge and the section (or the document's title), then a small "open" link. The rest (the
  // document, who made it, when it took effect) opens under it, so the answer's words lead and the detail is one tap away.
  return h(
    'li',
    { class: 'cite' },
    h(
      'details',
      { class: 'cite-more' },
      h(
        'summary',
        {},
        h('span', { class: 'badge', title: s.groundHint }, s.ground),
        h('strong', { class: c.heading ? 'cite-heading' : 'cite-title' }, c.heading || c.title),
      ),
      c.heading ? h('span', { class: 'cite-title' }, c.title) : null,
      meta ? h('span', { class: 'cite-meta' }, meta) : null,
    ),
    c.url
      ? h('a', { class: 'cite-link', href: c.url, target: '_blank', rel: 'noopener noreferrer' }, s.openSource)
      : null,
  );
}

/**
 * An answer is shown as plain text: no markdown marks. A model often writes **bold**, # headings, `code`, > quotes and
 * [links](url); on this page they would show as stray symbols, so they are taken out and only the words stay. Line breaks
 * and paragraphs are kept; list items start with a plain dash.
 */
export function plainText(raw: string): string {
  // No lookbehind anywhere: older phones' browsers cannot parse it, and a parse error here would stop the whole chat from loading.
  const edge = '(^|[\\s(])'; // an emphasis mark opens at the start of a word...
  const close = '(?=$|[\\s).,;:!?])'; // ...and closes at its end, so snake_case and __init__ are left alone
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/```[^\n]*\n?([\s\S]*?)```/g, '$1') // fenced code: keep what is inside
    // [text](url) -> "text (url)" (the address is kept: it is the pointer to the source), or just the address when there is no text
    .replace(/!?\[([^\]]*)\]\(([^)\s]*)[^)]*\)/g, (_m, text: string, url: string) => (text.trim() ? (url && url !== text ? `${text} (${url})` : text) : url))
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '') // # headings
    .replace(/^[ \t]{0,3}>[ \t]?/gm, '') // > quotes
    .replace(/^[ \t]*[*+][ \t]+/gm, '- ') // * item, + item -> - item
    .replace(/^[ \t]*(?:[-*_][ \t]*){3,}$/gm, '') // --- rules
    .replace(/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/gm, '') // | --- | --- | table separator rows
    .replace(/^[ \t]*\|(.*?)\|?[ \t]*$/gm, (_m, row: string) => row.split('|').map((c) => c.trim()).join(' · ')) // | a | b | rows
    .replace(new RegExp(`${edge}(\\*\\*|__)(\\S(?:.*?\\S)?)\\2${close}`, 'g'), '$1$3') // **bold**, __bold__
    .replace(new RegExp(`${edge}([*_])(\\S(?:.*?\\S)?)\\2${close}`, 'g'), '$1$3') // *italic*, _italic_
    .replace(/`([^`\n]+)`/g, '$1') // `code`
    .replace(/~~(.+?)~~/g, '$1') // ~~struck~~
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function renderAnswer(
  m: StoredMessage,
  a: Answer,
  s: Strings,
  lang: Language,
  onSave?: () => void,
): HTMLElement {
  const save = onSave ? h('button', { type: 'button', class: 'btn link save-answer' }, s.saveAnswer) : null;
  save?.addEventListener('click', onSave!);
  // Copy: the answer's own words, to the clipboard. Where the browser has no clipboard the button is simply not offered.
  const words = plainText(a.text);
  const copy = typeof navigator.clipboard?.writeText === 'function' ? h('button', { type: 'button', class: 'btn link copy-answer' }, s.copyAnswer) : null;
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  copy?.addEventListener('click', () => {
    void navigator.clipboard.writeText(words).then(
      () => {
        copy.textContent = s.copied;
        clearTimeout(copiedTimer);
        copiedTimer = setTimeout(() => (copy.textContent = s.copyAnswer), 1500);
      },
      () => undefined,
    );
  });
  // Share: the answer and where it came from, through the phone's own share sheet (WhatsApp and the like). Only offered where the
  // browser can share. Text, not an icon.
  const share =
    typeof navigator.share === 'function'
      ? h('button', { type: 'button', class: 'btn link share-answer' }, s.shareAnswer)
      : null;
  share?.addEventListener('click', () => {
    const from = a.citations.map((c) => (c.heading ? `${c.heading}, ${c.title}` : c.title)).join('\n');
    const text = [words, from, `${location.origin}/lite/`].filter(Boolean).join('\n\n');
    void navigator.share({ title: s.shamwari, text }).catch((e: unknown) => {
      // Closing the share sheet is not an error. Anything else (no share target, blocked): the words go to the clipboard instead.
      if ((e as { name?: string })?.name !== 'AbortError') void navigator.clipboard?.writeText(text).catch(() => undefined);
    });
  });
  return h(
    'article',
    { class: 'msg bot', 'data-id': m.id, 'aria-label': s.shamwari },
    h('p', { class: 'who' }, s.shamwari),
    h('p', { class: 'text' }, words),
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
    copy || save || share ? h('div', { class: 'msg-actions' }, copy, share, save) : null,
  );
}

export interface QueueActions {
  sendNow(): void;
  discard(): void;
}

export interface AttachmentActions {
  /** Play a voice note or save a copy of a file, from the copy kept on this device. */
  open(a: AttachmentMeta): void;
}

/** The files and voice notes kept with a question: each says plainly that it stayed on this device. */
function renderAttachments(m: StoredMessage, s: Strings, files?: AttachmentActions): HTMLElement | null {
  if (!m.attachments?.length) return null;
  return h(
    'ul',
    { class: 'attachments', 'aria-label': s.attachments },
    ...m.attachments.map((a) => {
      const open = h('button', { type: 'button', class: 'attach-open' }, a.kind === 'voice' ? s.playVoice : s.saveCopy);
      open.setAttribute('aria-label', `${a.kind === 'voice' ? s.playVoice : s.saveCopy}: ${a.name}`);
      open.addEventListener('click', () => files?.open(a));
      return h(
        'li',
        { class: 'attach-chip' },
        h('span', { class: 'attach-name' }, a.name),
        h('span', { class: 'attach-meta' }, `${sizeLabel(a.size)} · ${s.attachKept}`),
        files ? open : null,
      );
    }),
  );
}

export function renderUser(m: StoredMessage, s: Strings, queue?: QueueActions, files?: AttachmentActions): HTMLElement {
  const el = h(
    'article',
    { class: 'msg user', 'data-id': m.id, 'aria-label': s.you },
    h('p', { class: 'who' }, s.you),
    h('p', { class: 'text' }, m.text),
    renderAttachments(m, s, files),
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
  el.classList.toggle('queued', m.status === 'queued' || m.status === 'local');
  if (m.status === 'local') {
    // Written in offline mode: kept on this device and not sent, which is the point, so it is said plainly. Only with
    // offline mode off does it offer to be sent, and then only as the person's own act: nothing sends it by itself.
    const note = h('div', { class: 'queue-extra' }, h('p', { class: 'note', role: 'status' }, m.hint === 'stopped' ? s.stopped : s.offlineLocal));
    if (queue) {
      const now = h('button', { type: 'button', class: 'btn' }, s.sendNow);
      const drop = h('button', { type: 'button', class: 'btn' }, s.discard);
      now.addEventListener('click', queue.sendNow);
      drop.addEventListener('click', queue.discard);
      note.append(h('div', { class: 'row' }, now, drop));
    }
    el.append(note);
    return;
  }
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
