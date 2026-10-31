import { developerKey } from './auth';
import { createClient } from './client';
import { applyStrings, currentLanguage, saveLanguage } from './i18n';
import {
  h,
  renderAnswer,
  renderError,
  renderPending,
  renderUser,
  type ErrorActions,
} from './render';
import { newId, openStore, titleOf, type StoredMessage, type Thread } from './store';
import { LANGUAGES, isLanguage } from './strings';
import type { ChatMessage, Scope } from './types';

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

  const fresh = (): Thread => ({ id: newId(), title: '', updatedAt: Date.now(), messages: [] });
  const saved = await store.list();
  let thread: Thread = saved.find((t) => t.messages.length) ?? fresh();

  const log = $('#log');
  const input = $<HTMLTextAreaElement>('#q');
  const form = $<HTMLFormElement>('#composer');
  const sendBtn = $<HTMLButtonElement>('#send');
  const strings = () => LANGUAGES[lang].strings;
  const nodes = new Map<string, HTMLElement>();

  const persist = async () => {
    thread.updatedAt = Date.now();
    if (thread.messages.length) await store.put(thread);
  };

  // ---- rendering -----------------------------------------------------------
  const actionsFor = (m: StoredMessage): ErrorActions => ({
    retry: () => void send(m),
    askGeneral: () => void ask(m.text, 'platform'),
    signIn: () => showAuth(),
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
    place(m.id, renderUser(m, s));
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
    const list = (await store.list()).filter((t) => t.id !== thread.id && t.messages.length);
    const ul = $('#history-list');
    ul.replaceChildren(
      ...list.map((t) => {
        const b = h('button', { type: 'button', class: 'btn link' }, t.title || '…');
        b.addEventListener('click', () => {
          thread = t;
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
  const contextFor = (target: StoredMessage): ChatMessage[] => {
    const out: ChatMessage[] = [];
    for (const m of thread.messages) {
      if (m === target) break;
      if (m.role === 'assistant') out.push({ role: 'assistant', content: m.text });
      else if (!m.error && m.status !== 'queued') out.push({ role: 'user', content: m.text });
    }
    out.push({ role: 'user', content: target.text });
    return out.slice(-(saveData() ? CONTEXT_SAVER : CONTEXT));
  };

  async function send(m: StoredMessage): Promise<void> {
    if (busy) return;
    if (!auth.getKey()) {
      showAuth();
      return;
    }
    setBusy(true);
    delete m.error;
    m.status = 'sent';
    mount(m);
    nodes.get(`${m.id}:error`)?.remove();
    nodes.delete(`${m.id}:error`);

    const s = strings();
    const pending = place(`${m.id}:pending`, renderPending(m.id, s), m.id);
    pending.scrollIntoView({ block: 'end' });
    const slow = setTimeout(() => pending.append(h('p', { class: 'note' }, s.slow)), SLOW_AFTER_MS);

    const res = await client.ask(
      { messages: contextFor(m), scope: m.scope ?? 'platform' },
      { idempotencyKey: m.id },
    );
    clearTimeout(slow);
    pending.remove();
    nodes.delete(`${m.id}:pending`);

    if (res.ok) {
      const reply: StoredMessage = {
        id: newId(),
        role: 'assistant',
        text: res.value.text,
        at: Date.now(),
        answer: res.value,
      };
      thread.messages.push(reply);
      mount(reply);
      nodes.get(reply.id)!.scrollIntoView({ block: 'start' });
    } else {
      const { kind, retryAfterSec, upgradeUrl } = res.error;
      m.status = 'failed';
      m.error = { kind, retryAfterSec, upgradeUrl };
      mount(m);
      if (kind === 'unauthorized') showAuth();
    }
    await persist();
    setBusy(false);
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
    mount(m);
    input.value = '';
    autosize();
    await send(m);
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
    await store.clear();
    thread = fresh();
    rebuild();
    void renderHistory();
    const toast = $('#toast');
    toast.textContent = strings().deleted;
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
  addEventListener('online', online);
  addEventListener('offline', online);

  // ---- go ------------------------------------------------------------------
  applyStrings(document, lang);
  rebuild();
  online();
  syncAuth();
  void renderHistory();
  if (!auth.getKey()) authPanel.hidden = false;
  document.documentElement.dataset.ready = 'true';
}
