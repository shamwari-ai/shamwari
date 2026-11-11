import { developerKey } from './auth';
import { mukokoAuth } from './auth-mukoko';
import { trackChrome } from './chrome';
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
import { newId, openStore, titleOf, type Artifact, type Project, type StoredMessage, type Thread } from './store';
import { LANGUAGES, isLanguage } from './strings';
import type { AskErrorKind, ChatMessage, Scope } from './types';

const RETRY_FIRST_MS = 15_000;
const RETRY_MAX_MS = 5 * 60_000;
/** Unanswered tries, while the browser reports online, before it stops retrying quietly. */
const MAX_SILENT_ATTEMPTS = 3;
/** Failures that say nothing about the question itself, so it waits and is sent again by itself. */
const TRANSIENT: AskErrorKind[] = ['offline', 'unavailable', 'busy'];

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

export async function startApp(opts: { apiBase: string; authMode?: 'developer-key' | 'mukoko' }): Promise<void> {
  const store = await openStore();
  // The Mukoko provider is behind a build flag and off by default; the developer
  // key stays exactly as it was until the session Worker ships.
  const auth = opts.authMode === 'mukoko' ? mukokoAuth() : developerKey();
  const client = createClient({
    baseUrl: opts.apiBase,
    getKey: () => auth.ensureKey(),
    onUnauthorized: () => auth.refresh(),
  });
  document.documentElement.dataset.auth = auth.kind;

  let lang = currentLanguage();
  let scope: Scope = 'platform';
  /** Messages with a request in flight. Replaces one global lock, so asking and the queue never block each other. */
  const inflight = new Set<string>();
  let flushing = false;
  let flushAgain = false;
  let retryMs = RETRY_FIRST_MS;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * One object per thread, however often the store is read. Without it, opening
   * a chat from history, or a background send, would work on a stale copy that a
   * later write then overwrites.
   */
  const live = new Map<string, Thread>();
  const fresh = (): Thread => {
    const t: Thread = { id: newId(), title: '', updatedAt: Date.now(), messages: [] };
    live.set(t.id, t);
    return t;
  };

  const log = $('#log');
  const input = $<HTMLTextAreaElement>('#q');
  const form = $<HTMLFormElement>('#composer');
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
      if (m.role === 'user' && m.status === 'sent' && !inflight.has(m.id) && t.messages[i + 1]?.role !== 'assistant') {
        m.status = 'queued';
        changed = true;
      }
    });
    return changed;
  };

  /** Every stored thread, newest first; a failing store reads as empty, never as a crash. */
  const listThreads = async (): Promise<Thread[]> => {
    const stored = await store.list().catch(() => [] as Thread[]);
    return stored.map((t) => {
      const known = live.get(t.id);
      if (known) return known;
      live.set(t.id, t);
      if (recover(t)) void save(t); // only a thread seen for the first time can hold an interrupted send
      return t;
    });
  };

  const saved = await listThreads();
  let thread: Thread = saved.find((t) => t.messages.length) ?? fresh();
  /** Bumped by Delete history, so a request still in flight cannot write its thread back. */
  let epoch = 0;
  /** The start-up renewal while it is in flight (Mukoko only). A send in that window waits for it. */
  let startup: Promise<void> | null = null;

  // ---- rendering -----------------------------------------------------------
  const actionsFor = (m: StoredMessage): ErrorActions => ({
    retry: () => void deliver(thread, m),
    askGeneral: () => void ask(m.text, 'platform'),
    signIn: () => showAuth(),
  });

  const queueActionsFor = (m: StoredMessage): QueueActions => ({
    sendNow: () => void deliver(thread, m),
    discard: async () => {
      thread.messages = thread.messages.filter((x) => x !== m);
      nodes.get(m.id)?.remove();
      nodes.delete(m.id);
      syncEmpty();
      await save(thread);
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
      place(m.id, renderAnswer(m, m.answer, s, lang, () => void saveAnswer(m)));
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

  /** Close the chats drawer (a popover below 64rem) and the account menu: after an action they must not stay over the page. */
  const closeDrawer = () => (document.getElementById('chat-sidebar') as (HTMLElement & { hidePopover?: () => void }) | null)?.hidePopover?.();
  const closeAccount = () => document.querySelector('details.account')?.removeAttribute('open');
  /** Mzizi's AppShell names its menu and close buttons in English; name them in the chosen language. */
  const labelShell = () => {
    const s = strings();
    document.querySelector('[data-slot="app-topbar"] > button[popovertarget]')?.setAttribute('aria-label', s.openChats);
    document.querySelector('[data-slot="app-sidebar"] button[popovertargetaction="hide"]')?.setAttribute('aria-label', s.closeChats);
    document.querySelector('[data-slot="app-sidebar"]')?.setAttribute('aria-label', s.yourChats);
  };

  // ---- the drawer: pinned, projects, chats, artifacts ------------------------------------------------
  const openThread = async (id: string) => {
    // Read it again: a question queued in that chat may have been answered in the background since the list was drawn.
    const found = (await listThreads()).find((x) => x.id === id);
    if (!found) return;
    thread = found;
    rebuild();
    void renderHistory();
    closeDrawer();
    $('#thread').focus();
  };

  const threadButton = (t: Thread): HTMLElement => {
    const b = h('button', { type: 'button', class: 'btn link' }, t.title || '…');
    if (t.id === thread.id) b.setAttribute('aria-current', 'true');
    b.addEventListener('click', () => void openThread(t.id));
    return h('li', {}, b);
  };

  const saveProject = async (p: Project) => {
    p.updatedAt = Date.now();
    try {
      await store.putProject(p);
    } catch {
      $('#toast').textContent = strings().storageFailed;
    }
  };

  let projectsNow: Project[] = [];

  const renderHistory = async () => {
    const s = strings();
    const all = (await listThreads()).filter((t) => t.messages.length);
    projectsNow = await store.projects().catch(() => [] as Project[]);
    const artifacts = await store.artifacts().catch(() => [] as Artifact[]);

    // Pinned: pinned projects, then pinned chats that are not already inside a project.
    const pinnedProjects = projectsNow.filter((p) => p.pinned);
    const pinnedChats = all.filter((t) => t.pinned);
    $('#pinned-list').replaceChildren(
      ...pinnedProjects.map((p) => projectItem(p, all, s)),
      ...pinnedChats.map(threadButton),
    );
    $('#side-pinned').hidden = pinnedProjects.length + pinnedChats.length === 0;

    // Projects (the pinned ones are listed again here: Pinned is a shortcut, not a move).
    $('#project-list').replaceChildren(...projectsNow.map((p) => projectItem(p, all, s)));
    $('#project-empty').hidden = projectsNow.length > 0;

    // Loose chats: not pinned, not in a project, not the one on screen.
    const loose = all.filter((t) => t.id !== thread.id && !t.pinned && !t.projectId);
    $('#history-list').replaceChildren(...loose.map(threadButton));
    $('#history').hidden = loose.length === 0;

    $('#artifact-list').replaceChildren(
      ...artifacts.map((a) => {
        const b = h('button', { type: 'button', class: 'btn link' }, a.title || '…');
        b.addEventListener('click', () => showArtifact(a));
        return h('li', {}, b);
      }),
    );
    $('#artifact-empty').hidden = artifacts.length > 0;

    syncChatTools();
  };

  /** One project: its chats, and the two things a person does to a project (pin it, delete it). */
  const projectItem = (p: Project, all: Thread[], s: ReturnType<typeof strings>): HTMLElement => {
    const inside = all.filter((t) => t.projectId === p.id);
    const pin = h('button', { type: 'button', class: 'btn', 'aria-pressed': String(!!p.pinned) }, p.pinned ? s.unpinProject : s.pinProject);
    pin.addEventListener('click', async () => {
      p.pinned = !p.pinned;
      await saveProject(p);
      void renderHistory();
    });
    const del = h('button', { type: 'button', class: 'btn danger' }, s.deleteProject);
    del.addEventListener('click', async () => {
      if (!confirm(s.deleteProjectConfirm)) return;
      // Its chats are kept: they go back to being loose chats.
      for (const t of inside) {
        delete t.projectId;
        await save(t);
      }
      await store.removeProject(p.id).catch(() => undefined);
      void renderHistory();
    });
    const summary = h('summary', {}, `${p.name} (${inside.length})`);
    return h('li', {}, h('details', { class: 'project' }, summary, h('ul', { class: 'side-list' }, ...inside.map(threadButton)), h('div', { class: 'row' }, pin, del)));
  };

  /** The open chat's tools: pin, project, delete. Only a chat with a question in it has any. */
  const syncChatTools = () => {
    const s = strings();
    const tools = $('#chat-tools');
    tools.hidden = thread.messages.length === 0;
    const pin = $('#pin-chat');
    pin.textContent = thread.pinned ? s.unpin : s.pin;
    pin.setAttribute('aria-pressed', String(!!thread.pinned));
    const sel = $<HTMLSelectElement>('#chat-project');
    sel.replaceChildren(
      h('option', { value: '' }, s.noProject),
      ...projectsNow.map((p) => h('option', { value: p.id }, p.name)),
    );
    sel.value = thread.projectId && projectsNow.some((p) => p.id === thread.projectId) ? thread.projectId : '';
  };

  $('#pin-chat').addEventListener('click', async () => {
    thread.pinned = !thread.pinned;
    await save(thread);
    void renderHistory();
  });
  $('#chat-project').addEventListener('change', async () => {
    const id = $<HTMLSelectElement>('#chat-project').value;
    if (id) thread.projectId = id;
    else delete thread.projectId;
    await save(thread);
    void renderHistory();
  });
  $('#delete-chat').addEventListener('click', async () => {
    if (!confirm(strings().deleteChatConfirm)) return;
    const gone = thread;
    live.delete(gone.id);
    gone.messages = [];
    await save(gone); // an empty thread is removed from the store
    thread = fresh();
    rebuild();
    void renderHistory();
    input.focus();
  });
  $<HTMLFormElement>('#project-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const field = $<HTMLInputElement>('#project-name');
    const name = field.value.trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!name) return;
    await saveProject({ id: newId(), name, updatedAt: Date.now() });
    field.value = '';
    void renderHistory();
  });

  // ---- artifacts: an answer kept apart from its chat ------------------------------------------------
  const dialog = $<HTMLDialogElement>('#artifact-view');
  let shown: Artifact | null = null;
  const showArtifact = (a: Artifact) => {
    shown = a;
    $('#artifact-title-view').textContent = a.title;
    $('#artifact-text').textContent = a.text;
    $('#artifact-cites').replaceChildren(
      ...a.citations.map((c) => h('li', {}, c.heading ? `${c.title} — ${c.heading}` : c.title)),
    );
    $('#artifact-open').hidden = !live.has(a.threadId);
    closeDrawer();
    dialog.showModal();
  };
  $('#artifact-close').addEventListener('click', () => dialog.close());
  $('#artifact-open').addEventListener('click', () => {
    const id = shown?.threadId;
    dialog.close();
    if (id) void openThread(id);
  });
  $('#artifact-remove').addEventListener('click', async () => {
    if (shown) await store.removeArtifact(shown.id).catch(() => undefined);
    dialog.close();
    void renderHistory();
  });
  const saveAnswer = async (m: StoredMessage) => {
    if (!m.answer) return;
    const q = thread.messages[thread.messages.indexOf(m) - 1];
    try {
      await store.putArtifact({
        id: newId(),
        threadId: thread.id,
        title: titleOf(q?.text || m.answer.text),
        text: m.answer.text,
        citations: m.answer.citations,
        savedAt: Date.now(),
      });
      $('#toast').textContent = strings().answerSaved;
    } catch {
      $('#toast').textContent = strings().storageFailed;
    }
    void renderHistory();
  };

  const syncBusy = () => log.setAttribute('aria-busy', String(inflight.size > 0));

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
    if (inflight.has(m.id)) return;
    if (!auth.signedIn()) {
      showAuth();
      return;
    }
    const shown = () => th === thread;
    const startedIn = epoch;
    inflight.add(m.id);
    syncBusy();
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

      let res = await client.ask(
        { messages: contextFor(th, m), scope: m.scope ?? 'platform' },
        { idempotencyKey: m.id },
      );
      // No credential could be obtained (the renewal failed on the network, say) for
      // someone who IS signed in: that is "the answer did not arrive", and the
      // question waits. It is not "signed out", and must not end their session.
      if (!res.ok && res.error.kind === 'unauthorized' && res.error.status === null && auth.signedIn()) {
        res = { ok: false, error: { ...res.error, kind: 'offline' } };
      }
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
        delete m.hint;
        if (shown()) {
          mount(m);
          place(reply.id, renderAnswer(reply, res.value, strings(), lang, () => void saveAnswer(reply)), m.id);
          nodes.get(reply.id)!.scrollIntoView({ block: 'start' });
        }
        retryMs = RETRY_FIRST_MS;
      } else if (TRANSIENT.includes(res.error.kind)) {
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
          m.error = { kind: res.error.kind, retryAfterSec: res.error.retryAfterSec, upgradeUrl: null };
        } else {
          // Not an error: the answer did not arrive, so the question waits and
          // is sent again by itself. Nothing is lost and the person is told so.
          m.status = 'queued';
          m.hint = res.error.kind as 'offline' | 'unavailable' | 'busy';
          scheduleRetry();
        }
        if (shown()) mount(m);
      } else {
        const { kind, retryAfterSec, upgradeUrl } = res.error;
        m.status = 'failed';
        m.error = { kind, retryAfterSec, upgradeUrl };
        if (shown()) mount(m);
        if (kind === 'unauthorized') {
          // Only the gateway's own 401, repeated after one silent renewal, ends a
          // session. A missing credential on its own does not.
          if (res.error.status === 401) auth.invalidate();
          showAuth();
        }
      }
      await save(th);
    } finally {
      clearTimeout(slow);
      inflight.delete(m.id);
      syncBusy();
    }
  }

  const hasQueued = (ths: Thread[]) => ths.some((t) => t.messages.some((m) => m.status === 'queued'));

  /**
   * Send every queued question, oldest thread first, one at a time, stopping at
   * the first that cannot go. A trigger that arrives while it runs (the network
   * came back, the tab was shown) is not dropped: it runs again once.
   */
  async function flush(): Promise<void> {
    // Offline, a timer-driven try can only fail; the `online` event runs this again.
    if (!auth.signedIn() || !navigator.onLine) return;
    if (flushing) {
      flushAgain = true;
      return;
    }
    flushing = true;
    try {
      do {
        flushAgain = false;
        const startedIn = epoch;
        const others = (await listThreads()).filter((t) => t.id !== thread.id);
        for (const th of [...others.reverse(), thread]) {
          for (const m of th.messages.filter((x) => x.status === 'queued' && !inflight.has(x.id))) {
            await deliver(th, m);
            if (startedIn !== epoch) return; // Delete history ran: what is left of this list is gone
            if (m.status === 'queued') return; // still no way through: scheduleRetry already armed
          }
        }
      } while (flushAgain);
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
    if (!clean) return;
    // Straight after the sign-in redirect the cookie has not been turned into a token yet. A
    // question sent in that window waits for the start-up renewal instead of being dropped.
    if (startup) await startup;
    // No key yet: ask for one and keep what was typed, rather than eating the question.
    if (!auth.signedIn()) {
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
      // Stored first, shown second: "waiting to send" must only appear once the
      // question is actually on the device, or a quick reload could lose it.
      await save(thread);
      mount(m);
      scheduleRetry();
    } else {
      await deliver(thread, m);
    }
    void renderHistory();
  }

  // ---- auth ----------------------------------------------------------------
  const authPanel = $('#auth');
  const syncAuth = () => {
    $('#signout').hidden = !auth.signedIn();
    $('#open-signin').hidden = auth.signedIn(); // "Sign in" is for someone who is not
  };
  function showAuth() {
    authPanel.hidden = false;
    (auth.kind === 'mukoko' ? $('#mukoko-signin') : $<HTMLInputElement>('#key')).focus();
  }

  $('#auth-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const field = $<HTMLInputElement>('#key');
    const bad = $('#key-error');
    if (!auth.setKey?.(field.value)) {
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
  $('#signout').addEventListener('click', async () => {
    closeAccount();
    // Start the sign-out (its first, synchronous part flips the app to signed out), then clear
    // the chats WITHOUT waiting on the network: a hung request must not leave the previous
    // person's chats on a phone that is being handed to someone else.
    const ended = Promise.resolve(auth.signOut());
    // A Mukoko account belongs to a person, and the phone may not. Signing out takes
    // their chats off this device so the next person to open it does not read them.
    if (auth.kind === 'mukoko') {
      await wipeHistory();
      $('#toast').textContent = strings().signedOutCleared;
    }
    await ended;
    syncAuth();
    showAuth();
  });
  const mukokoBtn = $<HTMLButtonElement>('#mukoko-signin');
  if (auth.kind === 'mukoko') {
    // The session Worker sends a failed sign-in back here as /lite/?signin=failed. Say so kindly, and
    // drop the parameter so a reload does not say it again.
    const params = new URLSearchParams(location.search);
    if (params.get('signin') === 'failed') {
      $('#toast').textContent = strings().signInFailed;
      params.delete('signin');
      const rest = params.toString();
      history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
    }
    mukokoBtn.disabled = false;
    $('#mukoko-soon').hidden = true;
    mukokoBtn.removeAttribute('aria-describedby'); // it pointed at the "coming soon" text
    $('#signout').dataset.i18n = 'signOut';
    mukokoBtn.addEventListener('click', async () => {
      if (auth.prepareSignIn && !(await auth.prepareSignIn())) {
        $('#toast').textContent = strings().signInRetry;
        return;
      }
      location.assign('/lite/auth/login');
    });
  }

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

  // The top bar's icons. The account menu is Mzizi's disclosure pattern and opens by itself; "Sign in" inside
  // it brings the sign-in panel up. There are no notifications to show yet, and the bell says so rather
  // than doing nothing.
  $('#open-signin').addEventListener('click', () => {
    closeAccount();
    showAuth();
  });
  let bellTimer: ReturnType<typeof setTimeout> | undefined;
  $('#bell').addEventListener('click', () => {
    // Clear first so a second tap is announced again, and clear after a few seconds so the line
    // does not sit next to unrelated state.
    const toast = $('#toast');
    clearTimeout(bellTimer);
    toast.textContent = '';
    setTimeout(() => (toast.textContent = strings().noNotifications), 50);
    bellTimer = setTimeout(() => {
      if (toast.textContent === strings().noNotifications) toast.textContent = '';
    }, 4000);
  });

  // The drawer's foot: New chat and the account, as in the top bar.
  $('#side-new').addEventListener('click', () => {
    closeDrawer();
    document.querySelector<HTMLButtonElement>('#new-chat button')?.click();
  });
  $('#side-account').addEventListener('click', () => {
    closeDrawer();
    const menu = document.querySelector<HTMLDetailsElement>('details.account');
    if (menu) menu.open = true;
    menu?.querySelector('summary')?.focus();
  });

  $('#new-chat').addEventListener('click', () => {
    if (thread.messages.length) {
      thread = fresh();
      rebuild();
      void renderHistory();
    }
    input.focus();
  });

  /** Remove every chat from this device. Anything in flight belongs to what is being removed. */
  async function wipeHistory() {
    epoch += 1;
    clearTimeout(retryTimer);
    try {
      await store.clear();
    } catch {
      /* the in-memory thread is replaced below either way */
    }
    live.clear();
    thread = fresh();
    rebuild();
    void renderHistory();
  }

  $('#delete-history').addEventListener('click', async () => {
    if (!confirm(strings().deleteConfirm)) return;
    closeAccount();
    await wipeHistory();
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
    labelShell();
    rebuild();
    void renderHistory();
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
  labelShell();
  rebuild();
  online();
  syncAuth();
  void renderHistory();
  trackChrome();
  document.documentElement.dataset.ready = 'true';
  const afterAuth = () => {
    document.documentElement.dataset.authReady = 'true';
    if (navigator.onLine && hasQueued([thread, ...saved])) void flush();
  };
  if (auth.kind === 'mukoko') {
    // One silent renewal at start (the session cookie, if there is one, becomes a
    // token in memory), alongside the UI instead of in front of it: a slow link
    // must not hold up showing and writing questions. Until it answers, the
    // sign-in panel stays down so a signed-in person never sees it flash.
    startup = auth.refresh().then(() => {
      startup = null;
      authPanel.hidden = auth.signedIn();
      syncAuth();
      afterAuth();
    });
  } else {
    if (!auth.signedIn()) authPanel.hidden = false;
    afterAuth();
  }
}
