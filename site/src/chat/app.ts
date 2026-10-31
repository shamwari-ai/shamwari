import { developerKey } from './auth';
import { createClient } from './client';
import { applyStrings, currentLanguage, saveLanguage } from './i18n';
import {
  h,
  renderAnswer,
  renderError,
  renderPending,
  renderUser,
  updateUser,
  type ErrorActions,
  type QueueActions,
} from './render';
import { newId, openStore, titleOf, type StoredMessage, type Thread } from './store';
import { LANGUAGES, isLanguage } from './strings';
import type { ChatMessage, Scope } from './types';

const RETRY_FIRST_MS = 15_000;
const RETRY_MAX_MS = 5 * 60_000;
/** Unanswered tries, while the browser reports online, before it stops retrying quietly. */
const MAX_SILENT_ATTEMPTS = 3;

/** How many earlier messages travel with a question. Fewer on Data Saver. */
const CONTEXT = 6;
const CONTEXT_SAVER = 2;
const SLOW_AFTER_MS = 10_000;

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`chat: missing ${sel}`);
  return el;
};

const saveData = (): boolean =>
  (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;

export async function startApp(opts: { apiBase: string }): Promise<void> {
  const store = await openStore();
  const auth = developerKey();
  const client = createClient({ baseUrl: opts.apiBase, getKey: auth.getKey });

  let lang = currentLanguage();
  let scope: Scope = 'platform';
  let busy = false;
  let flushing = false;
  let retryMs = RETRY_FIRST_MS;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  const fresh = (): Thread => ({ id: newId(), title: '', updatedAt: Date.now(), messages: [] });

  const log = $('#log');
  const input = $<HTMLTextAreaElement>('#q');
  const form = $<HTMLFormElement>('#composer');
  const sendBtn = $<HTMLButtonElement>('#send');
  const strings = () => LANGUAGES[lang].strings;
  const nodes = new Map<string, HTMLElement>();

  /**
   * The one place a thread is written. An empty thread is deleted, not skipped,
   * or a discarded question would come back from the store on reload. A failed
   * write (quota, a closed connection) must never leave the app stuck, so it does
   * not throw: the thread stays correct in memory for this tab, and the person is
   * told it will not survive closing it, because "your question is not lost" is
   * only true while the write works.
   */
  const save = async (th: Thread) => {
    th.updatedAt = Date.now();
    try {
      if (th.messages.length) await store.put(th);
      else await store.remove(th.id);
    } catch {
      $('#toast').textContent = strings().storageFailed;
    }
  };

  /**
   * A question marked `sent` with nothing after it was interrupted (tab closed,
   * phone died mid-request). It goes back in the queue under the same key, so the
   * gateway replays the answer if it was already given. Applied to every thread
   * read from the store, and written back, so it holds for threads that are not
   * the one on screen.
   */
  const recover = (t: Thread): boolean => {
    let changed = false;
    t.messages.forEach((m, i) => {
      if (m.role === 'user' && m.status === 'sent' && t.messages[i + 1]?.role !== 'assistant') {
        m.status = 'queued';
        changed = true;
      }
    });
    return changed;
  };

  /** Every stored thread, newest first; a failing store reads as empty, never as a crash. */
  const listThreads = async (): Promise<Thread[]> => {
    const all = await store.list().catch(() => [] as Thread[]);
    for (const t of all) if (recover(t)) void save(t);
    return all;
  };

  const saved = await listThreads();
  let thread: Thread = saved.find((t) => t.messages.length) ?? fresh();
  /** Bumped by Delete history, so a request still in flight cannot write its thread back. */
  let epoch = 0;

  // ---- rendering -----------------------------------------------------------
  const actionsFor = (m: StoredMessage): ErrorActions => ({
    retry: () => void deliver(thread, m),
    askGeneral: () => void ask(m.text, 'platform'),
    signIn: () => showAuth(),
  });

  const queueActionsFor = (m: StoredMessage): QueueActions => ({
    sendNow: () => void deliver(thread, m),
    discard: () => {
      thread.messages = thread.messages.filter((x) => x !== m);
      nodes.get(m.id)?.remove();
      nodes.delete(m.id);
      syncEmpty();
      void save(thread);
    },
  });

  /** Put (or replace) one node under a stable key, so the live region only announces what changed. */
  const place = (key: string, el: HTMLElement, after?: string) => {
    const old = nodes.get(key);
    if (old) old.replaceWith(el);
    else if (after && nodes.get(after)) nodes.get(after)!.after(el);
    else log.append(el);
    nodes.set(key, el);
    return el;
  };

  const mount = (m: StoredMessage) => {
    const s = strings();
    if (m.role === 'assistant' && m.answer) {
      place(m.id, renderAnswer(m, m.answer, s, lang));
      return;
    }
    const existing = nodes.get(m.id);
    if (existing) updateUser(existing, m, s, queueActionsFor(m));
    else place(m.id, renderUser(m, s, queueActionsFor(m)));
    if (m.error) place(`${m.id}:error`, renderError(m.id, m.error, s, actionsFor(m)), m.id);
  };

  const syncEmpty = () => {
    $('#empty').hidden = thread.messages.length > 0;
  };

  const rebuild = () => {
    // Off while rebuilding: replacing the whole thread must not be read aloud again.
    log.setAttribute('aria-live', 'off');
    log.replaceChildren();
    nodes.clear();
    thread.messages.forEach(mount);
    log.setAttribute('aria-live', 'polite');
    syncEmpty();
  };

  const renderHistory = async () => {
    const list = (await listThreads()).filter((t) => t.id !== thread.id && t.messages.length);
    const ul = $('#history-list');
    ul.replaceChildren(
      ...list.map((t) => {
        const b = h('button', { type: 'button', class: 'btn link' }, t.title || '…');
        b.addEventListener('click', async () => {
          // Read it again: a question queued in that chat may have been
          // answered in the background since this list was drawn.
          thread = (await listThreads()).find((x) => x.id === t.id) ?? t;
          rebuild();
          void renderHistory();
          $('#thread').focus();
        });
        return h('li', {}, b);
      }),
    );
    $('#history').hidden = list.length === 0;
  };

  const setBusy = (v: boolean) => {
    busy = v;
    sendBtn.disabled = v;
    log.setAttribute('aria-busy', String(v));
  };

  // ---- asking --------------------------------------------------------------
  const contextFor = (th: Thread, target: StoredMessage): ChatMessage[] => {
    const out: ChatMessage[] = [];
    for (const m of th.messages) {
      if (m === target) break;
      if (m.role === 'assistant') out.push({ role: 'assistant', content: m.text });
      else if (!m.error && m.status !== 'queued') out.push({ role: 'user', content: m.text });
    }
    out.push({ role: 'user', content: target.text });
    return out.slice(-(saveData() ? CONTEXT_SAVER : CONTEXT));
  };

  /**
   * Send one question and record what came back. Works on any thread, because a
   * question queued offline is delivered even if the person has since started a
   * new chat; it only draws on screen when its thread is the one being shown.
   * The message id is the Idempotency-Key, so a retry after a dropped
   * connection is replayed by the gateway instead of answered and metered twice.
   */
  async function deliver(th: Thread, m: StoredMessage): Promise<void> {
    if (busy) return;
    if (!auth.getKey()) {
      showAuth();
      return;
    }
    const shown = () => th === thread;
    const startedIn = epoch;
    setBusy(true);
    let pending: HTMLElement | null = null;
    let slow: ReturnType<typeof setTimeout> | undefined;
    try {
      delete m.error;
      m.status = 'sent';
      // Written down BEFORE the request. A reload or a killed tab mid-flight
      // would otherwise lose the question; on load a `sent` question with no
      // answer is treated as queued and sent again under the same key.
      // Pressing "Send now" or "Try again" removes the very button that has focus
      // (its message changes state). Remember it, and move focus to the progress
      // note instead of dropping it to the page.
      const held = [nodes.get(m.id), nodes.get(`${m.id}:error`)].some((n) => n?.contains(document.activeElement));
      await save(th);
      if (shown()) {
        mount(m);
        nodes.get(`${m.id}:error`)?.remove();
        nodes.delete(`${m.id}:error`);
        const s = strings();
        pending = place(`${m.id}:pending`, renderPending(m.id, s), m.id);
        pending.scrollIntoView({ block: 'end' });
        if (held) {
          pending.tabIndex = -1;
          pending.focus({ preventScroll: true });
        }
        slow = setTimeout(() => pending?.append(h('p', { class: 'note' }, s.slow)), SLOW_AFTER_MS);
      }

      const res = await client.ask(
        { messages: contextFor(th, m), scope: m.scope ?? 'platform' },
        { idempotencyKey: m.id },
      );
      pending?.remove();
      nodes.delete(`${m.id}:pending`);
      // Delete history ran while this was in flight: the thread it belongs to is
      // gone, and writing it back would bring the deleted conversation back.
      if (startedIn !== epoch) return;

      if (res.ok) {
        const reply: StoredMessage = {
          id: newId(),
          role: 'assistant',
          text: res.value.text,
          at: Date.now(),
          answer: res.value,
        };
        // Right after its own question, which is not the end of the thread if
        // later questions were written while this one waited.
        th.messages.splice(th.messages.indexOf(m) + 1, 0, reply);
        delete m.attempts;
        if (shown()) {
          mount(m);
          place(reply.id, renderAnswer(reply, res.value, strings(), lang), m.id);
          nodes.get(reply.id)!.scrollIntoView({ block: 'start' });
        }
        retryMs = RETRY_FIRST_MS;
      } else if (res.error.kind === 'offline') {
        // Only a try made while the browser says it is online counts. Tries made
        // while truly offline are expected to fail and must not use up the allowance.
        if (navigator.onLine) m.attempts = (m.attempts ?? 0) + 1;
        if (navigator.onLine && (m.attempts ?? 0) >= MAX_SILENT_ATTEMPTS) {
          // The browser says it is online and the answer still never comes,
          // again and again. That is not a dead network but something between
          // here and the API (a blocked request, a misconfigured origin), so
          // say so and stop retrying quietly forever.
          m.attempts = 0;
          m.status = 'failed';
          m.error = { kind: 'offline', retryAfterSec: null, upgradeUrl: null };
        } else {
          // Not an error: the answer did not arrive, so the question waits and
          // is sent again by itself. Nothing is lost and the person is told so.
          m.status = 'queued';
          scheduleRetry();
        }
        if (shown()) mount(m);
      } else {
        const { kind, retryAfterSec, upgradeUrl } = res.error;
        m.status = 'failed';
        m.error = { kind, retryAfterSec, upgradeUrl };
        if (shown()) mount(m);
        if (kind === 'unauthorized') showAuth();
      }
      await save(th);
    } finally {
      clearTimeout(slow);
      setBusy(false);
    }
  }

  const hasQueued = (ths: Thread[]) => ths.some((t) => t.messages.some((m) => m.status === 'queued'));

  /** Send every queued question, oldest thread first, one at a time, stopping at the first that cannot go. */
  async function flush(): Promise<void> {
    // Offline, a timer-driven try can only fail; the `online` event runs this again.
    if (flushing || busy || !auth.getKey() || !navigator.onLine) return;
    flushing = true;
    try {
      const others = (await listThreads()).filter((t) => t.id !== thread.id);
      for (const th of [...others.reverse(), thread]) {
        for (const m of th.messages.filter((x) => x.status === 'queued')) {
          await deliver(th, m);
          if (m.status === 'queued') return; // still no network: scheduleRetry already armed
        }
      }
    } finally {
      flushing = false;
    }
  }

  function scheduleRetry() {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(() => void flush(), retryMs);
    retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
  }

  async function ask(text: string, withScope: Scope = scope): Promise<void> {
    const clean = text.trim();
    if (!clean || busy) return;
    // No key yet: ask for one and keep what was typed, rather than eating the question.
    if (!auth.getKey()) {
      showAuth();
      return;
    }
    const m: StoredMessage = { id: newId(), role: 'user', text: clean, at: Date.now(), scope: withScope, status: 'sent' };
    if (!thread.messages.length) thread.title = titleOf(clean);
    thread.messages.push(m);
    syncEmpty();
    input.value = '';
    autosize();
    if (!navigator.onLine) {
      // Offline: do not even try. Save it, say so, send it when the network is back.
      m.status = 'queued';
      mount(m);
      await save(thread);
      scheduleRetry();
    } else {
      await deliver(thread, m);
    }
    void renderHistory();
  }

  // ---- auth ----------------------------------------------------------------
  const authPanel = $('#auth');
  const syncAuth = () => {
    $('#signout').hidden = !auth.getKey();
  };
  function showAuth() {
    authPanel.hidden = false;
    $<HTMLInputElement>('#key').focus();
  }

  $('#auth-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const field = $<HTMLInputElement>('#key');
    const bad = $('#key-error');
    if (!auth.setKey(field.value)) {
      bad.hidden = false;
      field.setAttribute('aria-invalid', 'true');
      field.focus();
      return;
    }
    bad.hidden = true;
    field.removeAttribute('aria-invalid');
    field.value = '';
    authPanel.hidden = true;
    syncAuth();
    input.focus();
  });
  $('#signout').addEventListener('click', () => {
    auth.signOut();
    syncAuth();
    showAuth();
  });

  // ---- controls ------------------------------------------------------------
  const autosize = () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 128)}px`;
  };
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => {
    // Enter sends; Shift+Enter is a new line. Composition (IME) Enter must not send.
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    void ask(input.value);
  });

  const scopeSelect = $<HTMLSelectElement>('#scope');
  scopeSelect.addEventListener('change', () => {
    scope = scopeSelect.value as Scope;
  });
  document.querySelectorAll<HTMLButtonElement>('[data-example]').forEach((b) =>
    b.addEventListener('click', () => void ask(b.textContent ?? '')),
  );

  $('#new-chat').addEventListener('click', () => {
    if (thread.messages.length) {
      thread = fresh();
      rebuild();
      void renderHistory();
    }
    input.focus();
  });

  $('#delete-history').addEventListener('click', async () => {
    if (!confirm(strings().deleteConfirm)) return;
    // Anything still in flight or armed for retry belongs to what is being deleted.
    epoch += 1;
    clearTimeout(retryTimer);
    try {
      await store.clear();
    } catch {
      /* the in-memory thread is replaced below either way */
    }
    thread = fresh();
    rebuild();
    void renderHistory();
    $('#toast').textContent = strings().deleted;
    input.focus();
  });

  const langSelect = $<HTMLSelectElement>('#lang');
  langSelect.value = lang;
  langSelect.addEventListener('change', () => {
    if (!isLanguage(langSelect.value)) return;
    lang = langSelect.value;
    saveLanguage(lang);
    applyStrings(document, lang);
    rebuild();
  });

  const online = () => {
    $('#offline').hidden = navigator.onLine;
  };
  addEventListener('online', () => {
    online();
    retryMs = RETRY_FIRST_MS;
    void flush();
  });
  addEventListener('offline', online);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) void flush();
  });

  // ---- go ------------------------------------------------------------------
  applyStrings(document, lang);
  rebuild();
  online();
  syncAuth();
  void renderHistory();
  if (!auth.getKey()) authPanel.hidden = false;
  if (navigator.onLine && hasQueued([thread, ...saved])) void flush();
  document.documentElement.dataset.ready = 'true';
}
