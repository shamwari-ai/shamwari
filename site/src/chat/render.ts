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

/**
 * One of Mzizi's icons, cloned from the page's `<template id="glyphs">` (index.astro), decorative (the label beside it
 * names the thing). No SVG path is written here, and none is in the first-load script. Null where the page has no
 * template (unit tests), and the label stands alone.
 */
export function glyph(name: string): SVGElement | null {
  const t = typeof document === 'undefined' ? null : document.getElementById('glyphs');
  const svg = t instanceof HTMLTemplateElement ? t.content.querySelector(`[data-icon="${name}"]`) : null;
  return svg ? (svg.cloneNode(true) as SVGElement) : null;
}

/**
 * A quiet action under an answer: only its icon is drawn. Its words are its accessible name (read by a screen reader,
 * kept in the DOM, visually hidden) and its tooltip, so the button still says what it does.
 */
function action(cls: string, icon: string, label: string): HTMLButtonElement {
  return h('button', { type: 'button', class: `btn link act ${cls}`, title: label }, glyph(icon), h('span', { class: 'sr-only' }, label));
}

/**
 * How this answer was made, as a line with an icon in front of each step, folded under one summary like a work log:
 * the kind of question, the sources searched and how many were found, and who wrote it (the model that actually
 * served, as the gateway reported it) or that no model did. Every step is read from the gateway's own response;
 * nothing is guessed. It opens by itself when no model wrote the answer, because that is the thing to know.
 */
export function renderSteps(a: Answer, s: Strings): HTMLElement {
  const step = (icon: string, text: string) => h('li', {}, glyph(icon), h('span', {}, text));
  const sourcesOnly = a.degraded || a.inferencePath === 'extractive';
  return h(
    'details',
    { class: 'steps', open: sourcesOnly },
    h('summary', {}, glyph('list'), h('span', {}, s.howAnswered), h('span', { class: 'chev', 'aria-hidden': 'true' }, glyph('chevron-right'))),
    h(
      'ol',
      {},
      step('shield', `${s.scopeLabel}: ${s.scope[a.scope]}`),
      step('search', s.stepSearched.replace('{n}', String(a.citations.length))),
      sourcesOnly
        ? step('book', s.stepSourcesOnly)
        : a.modelServed
          ? step('sparkles', s.stepWritten.replace('{model}', a.modelServed))
          : null,
    ),
  );
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
  // One compact row: the Source badge and the section (or the document's title), then a small "open" link. The rest (the
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
        h('span', { class: 'badge' }, s.ground),
        h('strong', { class: c.heading ? 'cite-heading' : 'cite-title' }, c.heading || c.title),
      ),
      h('span', { class: 'cite-explain' }, s.groundHint),
      c.heading ? h('span', { class: 'cite-title' }, c.title) : null,
      meta ? h('span', { class: 'cite-meta' }, meta) : null,
    ),
    c.url
      ? h('a', { class: 'cite-link', href: c.url, target: '_blank', rel: 'noopener noreferrer' }, s.openSource)
      : null,
  );
}

/**
 * The formatted-answer drawing (markdown.ts, about 2.5 KB gzipped) is a part of its own, loaded the first time an answer
 * is shown, so the first load stays inside its budget. It is precached for offline. Until it is here (or if it cannot be
 * loaded) an answer is drawn as its plain words.
 */
let markdown: typeof import('./markdown') | undefined;
export const markdownReady = (): boolean => !!markdown;
export function loadMarkdown(): Promise<void> {
  return import('./markdown').then(
    (m) => {
      markdown = m;
    },
    () => undefined,
  );
}

/**
 * The answer's words with no markdown marks, for Copy, Share and Save: a clipboard and a WhatsApp message get plain words, not
 * stray symbols. (What is drawn on the page is the formatted answer, from markdown.ts.) A model often writes **bold**,
 * # headings, `code`, > quotes and [links](url); here they are taken out and only the words stay. Line breaks and paragraphs
 * are kept; list items start with a plain dash.
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
  const save = onSave ? action('save-answer', 'clipboard', s.saveAnswer) : null;
  save?.addEventListener('click', onSave!);
  // Copy: the answer's own words, to the clipboard. Where the browser has no clipboard the button is simply not offered.
  const words = plainText(a.text);
  const copy = typeof navigator.clipboard?.writeText === 'function' ? action('copy-answer', 'copy', s.copyAnswer) : null;
  // Copied: the icon turns to a tick and the words say so, then both go back.
  const mark = (done: boolean) => {
    if (!copy) return;
    const label = done ? s.copied : s.copyAnswer;
    copy.title = label;
    copy.replaceChildren(...[glyph(done ? 'check' : 'copy'), h('span', { class: 'sr-only' }, label)].filter((n): n is NonNullable<typeof n> => !!n));
  };
  let copiedTimer: ReturnType<typeof setTimeout> | undefined;
  copy?.addEventListener('click', () => {
    void navigator.clipboard.writeText(words).then(
      () => {
        mark(true);
        clearTimeout(copiedTimer);
        copiedTimer = setTimeout(() => mark(false), 1500);
      },
      () => undefined,
    );
  });
  // Share: the answer and where it came from, through the phone's own share sheet (WhatsApp and the like). Only offered where the
  // browser can share.
  const share = typeof navigator.share === 'function' ? action('share-answer', 'upload', s.shareAnswer) : null;
  share?.addEventListener('click', () => {
    const from = a.citations.map((c) => (c.heading ? `${c.heading}, ${c.title}` : c.title)).join('\n');
    const text = [words, from, `${location.origin}/chat/`].filter(Boolean).join('\n\n');
    void navigator.share({ title: s.shamwari, text }).catch((e: unknown) => {
      // Closing the share sheet is not an error. Anything else (no share target, blocked): the words go to the clipboard instead.
      if ((e as { name?: string })?.name !== 'AbortError') void navigator.clipboard?.writeText(text).catch(() => undefined);
    });
  });
  return h(
    'article',
    { class: 'msg bot', 'data-id': m.id, 'aria-label': s.shamwari },
    h('p', { class: 'who' }, s.shamwari),
    renderSteps(a, s),
    markdown ? markdown.renderMarkdown(a.text, { code: s.codeBlock, table: s.tableBox }) : h('p', { class: 'text' }, words),
    a.degraded ? h('p', { class: 'note' }, s.closestSource) : null,
    a.citations.length
      ? h(
          'section',
          { class: 'sources', 'aria-label': s.sources },
          h('h2', {}, s.sources),
          h('ul', {}, ...a.citations.map((c) => renderCitation(c, s, lang))),
        )
      : h('p', { class: 'note' }, s.noSources),
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
    // The skills it was asked with, as a part line: a personal one means cited sources only, and nothing went to a model.
    m.ownInformation ? h('p', { class: 'part' }, s.skillsOnPersonal) : m.skills?.length ? h('p', { class: 'part' }, s.skillsOn.replace('{n}', String(m.skills.length))) : null,
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

/**
 * The working line while an answer is on its way: Mzizi's sparkle turning in front of what Shamwari is doing, and how long
 * it has been at it. The gateway answers in one piece, so this names the whole of what it does (look for the answer) and
 * does not make up steps it cannot see; the steps are shown, from the response, once the answer is here (renderSteps).
 */
export function renderPending(id: string, s: Strings): HTMLElement {
  const clock = h('span', { class: 'run-time', 'aria-hidden': 'true' });
  const el = h(
    'article',
    { class: 'msg bot pending', 'data-id': `${id}:pending`, 'aria-label': s.shamwari },
    // The role sits on a div, not the article: an article may not carry it.
    h(
      'div',
      { role: 'status' },
      h('p', { class: 'who' }, s.shamwari),
      h('p', { class: 'text run' }, h('span', { class: 'run-mark', 'aria-hidden': 'true' }, glyph('sparkle')), h('span', {}, s.thinking), clock),
    ),
  );
  // The seconds it has been working, like a work log's timer. Hidden from screen readers: a live region that changed every
  // second would talk over everything else. It stops by itself once the line is gone.
  const started = Date.now();
  const tick = setInterval(() => {
    if (!el.isConnected) return clearInterval(tick);
    clock.textContent = `· ${Math.floor((Date.now() - started) / 1000)}s`;
  }, 1000);
  return el;
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
