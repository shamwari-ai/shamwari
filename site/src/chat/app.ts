import { developerKey } from './auth';
import { mukokoAuth } from './auth-mukoko';
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

/**
 * The only scope this client asks with. There is no control for it anywhere: the person is never asked which kind of
 * knowledge they mean. (Deciding it from the person and the question is a server-side change.) It is a constant, so
 * `personal` can never be sent from here, and a question saved under any other scope is never sent by itself (see deliver).
 */
const GENERAL: Scope = 'platform';
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
  /** Messages with a request in flight. Replaces one global lock, so asking and the queue never block each other. */
  const inflight = new Set<string>();
  let flushing = false;
  let flushAgain = false;
  let retryMs = RETRY_FIRST_MS;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * OFFLINE MODE (the switch in the top bar). While it is on NOTHING goes to the network: a question is written to this
   * device and stays there, no queue is replayed, no timer retries, and the session is not renewed. It is remembered
   * across reloads. Turning it off sends nothing by itself either: a question written in the mode waits for the person's
   * own "Send now"; only a question that was already queued before the mode went on resumes its normal retry.
   */
  const OFFLINE_KEY = 'shamwari.offlineMode';
  const readOffline = (): boolean => {
    try {
      return localStorage.getItem(OFFLINE_KEY) === '1';
    } catch {
      return false;
    }
  };
  let offlineMode = readOffline();

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
    askGeneral: () => void ask(m.text),
    signIn: () => showAuth(),
  });

  const queueActionsFor = (m: StoredMessage): QueueActions | undefined =>
    // A question kept by offline mode offers "Send now" only once the mode is off (and never sends by itself).
    m.status === 'local' && offlineMode ? undefined : queueActions(m);
  const queueActions = (m: StoredMessage): QueueActions => ({
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
    showSection('chat');
    closeDrawer();
    $('#thread').focus();
  };

  // ---- the drawer's sections: Chat, Projects, Artifacts, Plugins ------------------------------------------
  type Section = 'chat' | 'projects' | 'artifacts' | 'plugins';
  let pluginsLoaded = false;
  const showSection = (name: Section) => {
    document.querySelectorAll<HTMLElement>('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== name));
    document.querySelectorAll<HTMLElement>('[data-section]').forEach((b) => {
      if (b.dataset.section === name) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    if (name === 'plugins' && !pluginsLoaded) {
      pluginsLoaded = true;
      // Loaded on first use: the chat's first load does not carry the tabs.
      void import('./plugins').then((m) => m.initPlugins(document)).catch(() => (pluginsLoaded = false));
    }
  };
  document.querySelectorAll<HTMLElement>('[data-section]').forEach((b) => b.addEventListener('click', () => showSection(b.dataset.section as Section)));

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

    // Loose chats: not pinned, not in a project, not the one on screen.
    const loose = all.filter((t) => t.id !== thread.id && !t.pinned && !t.projectId);
    $('#history-list').replaceChildren(...loose.map(threadButton));
    $('#side-chats').hidden = loose.length === 0;
    $('#chats-empty').hidden = loose.length + pinnedProjects.length + pinnedChats.length > 0;

    $('#artifact-list').replaceChildren(
      ...artifacts.map((a) => {
        const b = h('button', { type: 'button', class: 'btn link' }, a.title || '…');
        b.addEventListener('click', () => showArtifact(a));
        return h('li', {}, b);
      }),
    );
    $('#side-artifacts').hidden = artifacts.length === 0;
    $('#artifacts-empty').hidden = artifacts.length > 0;

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
  const projectForm = $<HTMLFormElement>('#project-form');
  const newProjectButton = $('#new-project');
  newProjectButton.addEventListener('click', () => {
    projectForm.hidden = !projectForm.hidden;
    newProjectButton.setAttribute('aria-expanded', String(!projectForm.hidden));
    if (!projectForm.hidden) $<HTMLInputElement>('#project-name').focus();
  });
  projectForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const field = $<HTMLInputElement>('#project-name');
    const name = field.value.trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!name) return;
    await saveProject({ id: newId(), name, updatedAt: Date.now() });
    field.value = '';
    projectForm.hidden = true;
    newProjectButton.setAttribute('aria-expanded', 'false');
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
      else if (!m.error && m.status !== 'queued' && m.status !== 'local') out.push({ role: 'user', content: m.text });
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
    if (offlineMode) return; // defence in depth: nothing reaches the network while the mode is on
    if (!auth.signedIn()) {
      showAuth();
      return;
    }
    // A question saved from before there was one scope: `community` was allowed to reach the cloud, so it is sent as
    // it was saved. Anything else (`personal`, or a scope this version does not know) is not sent by itself, now or
    // later: nothing goes to the network. It is shown with the honest explanation and a button that asks it as a
    // general question, which is the person's own choice and a new question, never a quiet downgrade of this one.
    if (m.scope && m.scope !== GENERAL && m.scope !== 'community') {
      m.status = 'failed';
      m.error = { kind: 'scope_requires_local_inference', retryAfterSec: null, upgradeUrl: null };
      await save(th);
      if (th === thread) mount(m); // mount draws the error under the question
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
        { messages: contextFor(th, m), scope: m.scope === 'community' ? 'community' : GENERAL },
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
    if (!auth.signedIn() || !navigator.onLine || offlineMode) return;
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
    if (offlineMode) return;
    retryTimer = setTimeout(() => void flush(), retryMs);
    retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
  }

  async function ask(text: string): Promise<void> {
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
    const m: StoredMessage = { id: newId(), role: 'user', text: clean, at: Date.now(), scope: GENERAL, status: 'sent' };
    if (!thread.messages.length) thread.title = titleOf(clean);
    thread.messages.push(m);
    syncEmpty();
    input.value = '';
    autosize();
    if (offlineMode) {
      // Offline mode: written to this device and kept there. Not queued, not retried, never sent unless the person
      // turns the mode off and chooses "Send now".
      m.status = 'local';
      await save(thread);
      mount(m);
    } else if (!navigator.onLine) {
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
  /** Back from a sign-in that failed: stop here and say so, do not send the person round the same loop again. */
  const cameBackFailed = new URLSearchParams(location.search).get('signin') === 'failed';
  const syncAuth = () => {
    $('#signout').hidden = !auth.signedIn();
  };
  /** Which whole screen is showing: the chat, or the sign-in. Never both, and never the chat with a prompt on it. */
  const HOP = 'shamwari.signin.hop';
  const setView = (view: 'app' | 'signin' | 'pending') => {
    // A modal left open (a saved answer) would stay modal behind a hidden chat and come back stale.
    if (view !== 'app') document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach((d) => d.close());
    document.documentElement.dataset.view = view;
    // 'pending' is neither screen: the first answer from the session is awaited, so a person who has a session never sees
    // the sign-in flash and one who has none never sees the chat.
    authPanel.hidden = view !== 'signin';
  };
  const syncOffline = () => {
    $('#signin-offline').hidden = !(auth.kind === 'mukoko' && !navigator.onLine);
  };
  window.addEventListener('online', syncOffline);
  window.addEventListener('offline', syncOffline);
  /**
   * The sign-in screen. With a session that has ended and a network to reach it, the app goes straight to the hosted
   * sign-in instead (`redirect`), once: a sign-in that comes straight back signed out must stop here, not loop.
   */
  function showAuth(redirect = false) {
    setView('signin');
    const offline = !navigator.onLine;
    syncOffline();
    const go = $<HTMLButtonElement>('#mukoko-signin');
    if (redirect && auth.kind === 'mukoko' && !offline && !cameBackFailed) {
      let recent = false;
      try {
        recent = Date.now() - Number(sessionStorage.getItem(HOP) ?? 0) < 30_000;
        if (!recent) sessionStorage.setItem(HOP, String(Date.now()));
      } catch {
        /* no session storage: the sign-in screen is shown, which is the safe side */
        recent = true;
      }
      if (!recent) {
        location.replace('/lite/auth/login');
        return;
      }
    }
    (go.disabled || go.hidden ? $('#auth-title') : go).focus();
  }

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
    }
    // The screen changes now, without waiting on the network: a hung sign-out request must not leave the chat on show.
    syncAuth();
    showAuth();
    // On the sign-in screen itself: the chat (and its toast) is not on screen while signed out.
    if (auth.kind === 'mukoko') {
      const note = $('#signin-note');
      note.textContent = strings().signedOutCleared;
      note.hidden = false;
    }
    await ended;
    syncAuth();
  });
  const mukokoBtn = $<HTMLButtonElement>('#mukoko-signin');
  if (auth.kind === 'mukoko') {
    // The session Worker sends a failed sign-in back here as /lite/?signin=failed. Say so kindly, and
    // drop the parameter so a reload does not say it again.
    const params = new URLSearchParams(location.search);
    if (params.get('signin') === 'failed') {
      // On the sign-in screen itself: the chat (and its toast) is not on screen while signed out.
      $('#signin-failed').hidden = false;
      params.delete('signin');
      const rest = params.toString();
      history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
    }
    mukokoBtn.disabled = false;
    $('#mukoko-soon').hidden = true;
    mukokoBtn.removeAttribute('aria-describedby'); // it pointed at the "coming soon" text
    $('#signout').dataset.i18n = 'signOut';
    mukokoBtn.addEventListener('click', async () => {
      $('#signin-failed').hidden = true; // a new try: the old failure is not still the news
      $('#signin-note').hidden = true;
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

  // The three suggested prompts fill the box and put the cursor in it: one tap less than typing, and nothing is sent
  // until the person presses send (a prompt tapped by accident on a phone must not become a question).
  document.querySelectorAll<HTMLButtonElement>('[data-example]').forEach((b) =>
    b.addEventListener('click', () => {
      const text = (b.textContent ?? '').trim();
      // Never over a draft: what the person already typed is kept, and the prompt goes after it.
      input.value = input.value.trim() ? `${input.value.trimEnd()}\n${text}` : text;
      autosize();
      input.focus();
    }),
  );

  // The drawer's foot: New chat, as in the top bar. Settings is a disclosure and opens by itself.
  $('#side-new').addEventListener('click', () => {
    closeDrawer();
    document.querySelector<HTMLButtonElement>('#new-chat button')?.click();
  });
  $('#new-chat').addEventListener('click', () => {
    showSection('chat'); // a new chat is a chat: the drawer's next opening shows the chats again
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
    showSection('chat');
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
    syncOfflineMode();
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

  // ---- offline mode ---------------------------------------------------------------------------------------
  const offlineSwitch = $<HTMLButtonElement>('#offline-mode');
  const syncOfflineMode = () => {
    const s = strings();
    offlineSwitch.setAttribute('aria-checked', String(offlineMode));
    offlineSwitch.dataset.state = offlineMode ? 'on' : 'off';
    offlineSwitch.querySelector('.offline-state')!.textContent = offlineMode ? s.offlineModeOn : s.offlineModeOff;
    $('#offline-mode-note').hidden = !offlineMode;
    document.documentElement.toggleAttribute('data-offline-mode', offlineMode);
  };
  offlineSwitch.addEventListener('click', () => {
    offlineMode = !offlineMode;
    try {
      localStorage.setItem(OFFLINE_KEY, offlineMode ? '1' : '0');
    } catch {
      /* no storage: the mode holds for this visit only */
    }
    if (offlineMode) {
      clearTimeout(retryTimer); // nothing replays while it is on
    } else {
      retryMs = RETRY_FIRST_MS;
      // Back to normal: a session is renewed, and a question that was queued BEFORE the mode went on resumes its retry.
      // A question written IN the mode is not sent by this: it waits for the person's own "Send now".
      void (auth.kind === 'mukoko' ? auth.refresh() : Promise.resolve(true)).then(() => {
        if (!offlineMode && navigator.onLine && auth.signedIn()) void flush();
      });
    }
    syncOfflineMode();
    rebuild(); // each kept question shows the state that matches the mode
    void renderHistory();
  });

  // ---- go ------------------------------------------------------------------
  syncOfflineMode();
  applyStrings(document, lang);
  labelShell();
  rebuild();
  online();
  syncAuth();
  void renderHistory();
  // Before the first renewal answers: the chat only for a device that holds (or held) a session, else the sign-in screen.
  setView(auth.signedIn() ? 'app' : auth.kind === 'mukoko' ? 'pending' : 'signin');
  document.documentElement.dataset.ready = 'true';
  const afterAuth = () => {
    document.documentElement.dataset.authReady = 'true';
    if (navigator.onLine && !offlineMode && hasQueued([thread, ...saved])) void flush();
  };
  if (auth.kind === 'mukoko') {
    // One silent renewal at start (the session cookie, if there is one, becomes a
    // token in memory), alongside the UI instead of in front of it: a slow link
    // must not hold up showing and writing questions. Until it answers, the
    // sign-in panel stays down so a signed-in person never sees it flash.
    // In offline mode no request is made, not even the silent renewal: the hint of a past sign-in opens the chat.
    startup = (offlineMode && auth.signedIn() ? Promise.resolve(true) : auth.refresh()).then(() => {
      startup = null;
      // Signed in (a session, or the hint of one while offline): the chat. Otherwise the session has ended: straight to sign-in.
      if (auth.signedIn()) {
        setView('app');
        // A sign-in that worked: the next time a session ends it is a new story, so the guard against a loop is cleared.
        try {
          sessionStorage.removeItem(HOP);
        } catch {
          /* nothing to clear */
        }
      } else showAuth(true);
      syncAuth();
      afterAuth();
    });
  } else {
    if (auth.signedIn()) setView('app');
    else showAuth();
    afterAuth();
  }
}
