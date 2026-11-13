import { developerKey } from './auth';
import type { Attach } from './attach';
import { mukokoAuth } from './auth-mukoko';
import { createClient } from './client';
import { readStoredUser, rememberUser, subjectOf, userKeyOf } from './user';
import { applyStrings, currentLanguage, saveLanguage } from './i18n';
import {
  h,
  plainText,
  renderAnswer,
  renderError,
  renderPending,
  renderUser,
  updateUser,
  type ErrorActions,
  type QueueActions,
} from './render';
import { newId, openSwitchableStore, titleOf, type Artifact, type Project, type StoredMessage, type Thread } from './store';
import { LANGUAGES, isLanguage, loadStrings } from './strings';
import type { AskErrorKind, ChatMessage, Scope } from './types';
import { setBusy } from './busy';
import type { AuthMode } from './auth-mode';

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

export async function startApp(opts: { apiBase: string; authMode?: AuthMode }): Promise<void> {
  // One store per signed-in person (see user.ts). A device that has not been told who is using it holds the unowned store.
  const store = await openSwitchableStore(opts.authMode === 'mukoko' ? readStoredUser() : null);
  // Mukoko sign-in is the default mode (chat/auth-mode.ts); the developer key is built only on request, for local work.
  const auth = opts.authMode === 'mukoko' ? mukokoAuth() : developerKey();
  const client = createClient({
    baseUrl: opts.apiBase,
    getKey: () => auth.ensureKey(),
    onUnauthorized: () => auth.refresh(),
  });
  document.documentElement.dataset.auth = auth.kind;

  let lang = currentLanguage();
  let languageFailed = false;
  // Shona and Ndebele are separate files, kept out of the first load (English is always in the page). If the saved one cannot be fetched, show English.
  try {
    await loadStrings(lang);
  } catch {
    lang = 'en';
    languageFailed = true;
  }
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
    const gen = store.generation;
    const stored = await store.list().catch(() => [] as Thread[]);
    // The store was switched (to another person, or to nobody) while this read was out: what it returned belongs to the
    // store it began on, and must reach neither the screen nor the in-memory threads of whoever is there now.
    if (gen !== store.generation) return [];
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
      for (const a of m.attachments ?? []) void store.removeFile(a.id).catch(() => undefined);
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

  /** Open an attachment from the copy on this device: a voice note plays, a file is offered as a download. No request is made. */
  let voice: HTMLAudioElement | null = null;
  let voiceUrl = '';
  const attachmentActions = {
    open: async (a: { id: string; kind: 'file' | 'voice'; name: string }) => {
      const f = await store.getFile(a.id).catch(() => undefined);
      if (!f) {
        $('#toast').textContent = strings().attachmentGone;
        return;
      }
      const url = URL.createObjectURL(f.blob);
      if (a.kind === 'voice') {
        // One player: a second tap stops the first, so nothing overlaps and no URL is left behind.
        voice?.pause();
        if (voiceUrl) URL.revokeObjectURL(voiceUrl);
        voiceUrl = url;
        voice = new Audio(url);
        void voice.play().catch(() => undefined);
      } else {
        const link = h('a', { href: url, download: a.name });
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    },
  };

  const mount = (m: StoredMessage) => {
    const s = strings();
    if (m.role === 'assistant' && m.answer) {
      place(m.id, renderAnswer(m, m.answer, s, lang, () => void saveAnswer(m)));
      return;
    }
    const existing = nodes.get(m.id);
    if (existing) updateUser(existing, m, s, queueActionsFor(m));
    else place(m.id, renderUser(m, s, queueActionsFor(m), attachmentActions));
    if (m.error) place(`${m.id}:error`, renderError(m.id, m.error, s, actionsFor(m)), m.id);
  };

  const syncEmpty = () => {
    $('#empty').hidden = thread.messages.length > 0;
    // The page's one heading. With no messages it is the app's name, for screen readers only; with messages it is the
    // chat's title, shown in the top bar. data-i18n is dropped while it shows a title so a language change leaves it alone.
    const heading = $('#chat-title');
    const titled = thread.messages.length > 0;
    heading.classList.toggle('sr-only', !titled);
    if (titled) {
      heading.removeAttribute('data-i18n');
      heading.textContent = thread.title || strings().appName; // never an empty heading
    } else {
      heading.setAttribute('data-i18n', 'appName');
      heading.textContent = strings().appName;
    }
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
  const settingsDialog = document.getElementById('settings-dialog') as HTMLDialogElement;
  const closeAccount = () => {
    if (settingsDialog.open) settingsDialog.close();
  };
  // Settings is a modal: the drawer closes first, so nothing is left under it. Esc, the close button and a tap on the dim edge close it.
  document.getElementById('open-settings')?.addEventListener('click', () => {
    closeDrawer();
    settingsDialog.showModal();
  });
  document.getElementById('settings-close')?.addEventListener('click', () => settingsDialog.close());
  // A tap on the dim edge closes it: the dialog element itself is only the area outside its box. A drag that began inside
  // (selecting text, a select list) and ended out there must not close it, so the press has to start on the edge too.
  let pressedOutside = false;
  settingsDialog.addEventListener('pointerdown', (e) => {
    pressedOutside = e.target === settingsDialog;
  });
  settingsDialog.addEventListener('click', (e) => {
    if (e.target === settingsDialog && pressedOutside) settingsDialog.close();
  });
  settingsDialog.addEventListener('close', () => {
    // The button that opened it sat in a drawer that has closed; focus goes to the chat box rather than nowhere.
    setTimeout(() => {
      const at = document.activeElement as HTMLElement | null;
      if (!at || at === document.body || !at.checkVisibility()) document.getElementById('q')?.focus();
    }, 0); // after the browser has put focus back where it was
  });
  /**
   * The drawer is a popover below 64rem. While it is open the page slides aside (CSS, on html[data-drawer]), is inert so
   * nothing behind the drawer can be reached by keyboard or screen reader, the opening button says it is expanded, and
   * focus goes into the drawer and comes back to that button when it closes.
   */
  const drawer = document.getElementById('chat-sidebar') as HTMLElement | null;
  const drawerToggle = document.querySelector<HTMLElement>('[data-slot="app-topbar"] > button[popovertarget]');
  const pageFrame = document.querySelector<HTMLElement>('[data-slot="app-main"]');
  drawerToggle?.setAttribute('aria-expanded', 'false');
  // `beforetoggle` runs synchronously inside show/hidePopover(), so a caller that closes the drawer and then focuses the
  // question box (New chat) finds the page already reachable again. `toggle` runs after, for focus.
  drawer?.addEventListener('beforetoggle', (e) => {
    const open = (e as Event & { newState?: string }).newState === 'open';
    if (open) document.documentElement.setAttribute('data-drawer', 'open');
    else document.documentElement.removeAttribute('data-drawer');
    drawerToggle?.setAttribute('aria-expanded', String(open));
    if (pageFrame) pageFrame.inert = open;
  });
  // From 64rem the drawer is a permanent column, not a popover: if the screen grows while it is open (a tablet turned
  // sideways), close it so the page is not left inert.
  window.matchMedia('(min-width: 64rem)').addEventListener('change', (e) => {
    if (e.matches && drawer?.matches(':popover-open')) (drawer as HTMLElement & { hidePopover(): void }).hidePopover();
  });
  drawer?.addEventListener('toggle', (e) => {
    if ((e as Event & { newState?: string }).newState === 'open') {
      drawer.querySelector<HTMLElement>('button[popovertargetaction="hide"]')?.focus();
    } else if (!document.activeElement || document.activeElement === document.body || drawer.contains(document.activeElement)) {
      // Back to the button that opened it, unless the person already moved on to something else.
      drawerToggle?.focus();
    }
  });

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
    attach.clear(); // what was being added belongs to the chat it was added in
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

  /** The muted time at the right of a history row: the hour today, the weekday this week, else the day and month. */
  const whenOf = (at: number): string => {
    const d = new Date(at);
    const days = daysAgo(at);
    try {
      if (days <= 0) return d.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
      if (days < 7) return d.toLocaleDateString(lang, { weekday: 'short' });
      return d.toLocaleDateString(lang, { day: 'numeric', month: 'short' });
    } catch {
      return '';
    }
  };
  const startOfDay = (at: number): number => {
    const d = new Date(at);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  /** Whole calendar days from `at` to now. Rounded, not floored: a day with a clock change is 23 or 25 hours long. */
  const daysAgo = (at: number): number => Math.round((startOfDay(Date.now()) - startOfDay(at)) / 86_400_000);

  const threadButton = (t: Thread): HTMLElement => {
    const b = h(
      'button',
      { type: 'button', class: 'btn link side-row chat-row', title: t.title || '' },
      h('span', { class: 'chat-row-title' }, t.title || '…'),
      h('span', { class: 'chat-row-when', 'aria-hidden': 'true' }, whenOf(t.updatedAt)),
    );
    if (t.id === thread.id) b.setAttribute('aria-current', 'true');
    b.addEventListener('click', () => void openThread(t.id));
    // The row's own "...": shown on hover and on focus (always on touch), it opens the shared menu for THIS chat.
    const more = h(
      'button',
      { type: 'button', class: 'row-more', 'aria-haspopup': 'true', 'aria-label': `${strings().chatOptions}: ${t.title || ''}` },
      h('span', { 'aria-hidden': 'true' }, '…'),
    );
    more.addEventListener('click', () => openRowMenu(t, more));
    return h('li', { class: 'chat-li', 'data-id': t.id }, b, more);
  };

  // ---- the menu of one chat in the list -------------------------------------------------------------------
  const rowMenu = $('#row-menu') as HTMLElement & { showPopover(): void; hidePopover(): void };
  let menuFor: Thread | null = null;
  /** The thread a menu acts on: the open one is the live object, so a change is never written over by a stale copy. */
  const menuThread = (): Thread | null => (menuFor && menuFor.id === thread.id ? thread : menuFor);
  // Closed (by an action, Escape or a click away): forget the chat, and the "..." is no longer expanded.
  rowMenu.addEventListener('toggle', (e) => {
    if ((e as Event & { newState?: string }).newState === 'closed') {
      menuFor = null;
      document.querySelectorAll('.row-more[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    }
  });
  /** After the list is drawn again, focus goes back to that chat's "..." (or the first row), not to the top of the page. */
  const focusRow = (id: string) =>
    setTimeout(() => {
      const more = [...document.querySelectorAll<HTMLElement>('#chat-sidebar li.chat-li')].find((li) => li.dataset.id === id)?.querySelector<HTMLElement>('.row-more');
      (more ?? document.querySelector<HTMLElement>('#side-new'))?.focus();
    }, 50);
  const openRowMenu = (t: Thread, anchor: HTMLElement) => {
    const s = strings();
    menuFor = t;
    const pin = $('#row-pin');
    pin.textContent = t.pinned ? s.unpin : s.pin;
    pin.setAttribute('aria-pressed', String(!!t.pinned));
    const sel = $<HTMLSelectElement>('#row-project');
    sel.replaceChildren(h('option', { value: '' }, s.noProject), ...projectsNow.map((p) => h('option', { value: p.id }, p.name)));
    sel.value = t.projectId && projectsNow.some((p) => p.id === t.projectId) ? t.projectId : '';
    const r = anchor.getBoundingClientRect();
    anchor.setAttribute('aria-expanded', 'true');
    rowMenu.style.top = `${Math.round(r.bottom + 4)}px`;
    rowMenu.style.left = `${Math.round(r.left)}px`;
    rowMenu.showPopover();
    // Not off the screen: measured after it is shown. It opens above the "..." if there is no room below, and slides left if
    // there is none at the right.
    const box = rowMenu.getBoundingClientRect();
    if (r.bottom + 4 + box.height > innerHeight - 8) rowMenu.style.top = `${Math.max(8, Math.round(r.top - box.height - 4))}px`;
    rowMenu.style.left = `${Math.max(8, Math.min(Math.round(r.left), Math.round(innerWidth - box.width - 8)))}px`;
    $('#row-pin').focus();
  };
  const togglePin = async (t: Thread) => {
    t.pinned = !t.pinned;
    await save(t);
    void renderHistory();
  };
  const moveToProject = async (t: Thread, id: string) => {
    if (id) t.projectId = id;
    else delete t.projectId;
    await save(t);
    void renderHistory();
  };
  /** Delete one chat, after asking. The open one is replaced by a fresh chat. A chat that is still sending is not deleted. */
  const deleteThread = async (t: Thread): Promise<boolean> => {
    if (t.id !== thread.id && t.messages.some((m) => inflight.has(m.id) || m.status === 'queued')) {
      $('#toast').textContent = strings().deleteWait; // its answer would bring it back
      return false;
    }
    if (!confirm(strings().deleteChatConfirm)) return false;
    live.delete(t.id);
    void store.removeFilesOf(t.id).catch(() => undefined); // its attachments go with it
    const wasOpen = t.id === thread.id;
    if (wasOpen) attach.clear();
    t.messages = [];
    await save(t); // an empty thread is removed from the store
    if (wasOpen) {
      thread = fresh();
      rebuild();
      input.focus();
    }
    void renderHistory();
    return true;
  };

  $('#row-pin').addEventListener('click', async () => {
    const t = menuThread();
    if (!t) return;
    rowMenu.hidePopover();
    await togglePin(t);
    focusRow(t.id);
  });
  $('#row-project').addEventListener('change', async () => {
    const t = menuThread();
    if (!t) return;
    rowMenu.hidePopover();
    await moveToProject(t, $<HTMLSelectElement>('#row-project').value);
    focusRow(t.id);
  });
  $('#row-delete').addEventListener('click', async () => {
    const t = menuThread();
    if (!t) return;
    rowMenu.hidePopover();
    if (!(await deleteThread(t))) focusRow(t.id);
  });

  /** Loose chats under Today / Yesterday / Previous 7 days / Older, newest first. */
  const groupedChats = (chats: Thread[], s: ReturnType<typeof strings>): HTMLElement[] => {
    const buckets: [string, Thread[]][] = [
      [s.groupToday, []],
      [s.groupYesterday, []],
      [s.groupWeek, []],
      [s.groupOlder, []],
    ];
    for (const t of chats) {
      const days = daysAgo(t.updatedAt);
      buckets[days <= 0 ? 0 : days === 1 ? 1 : days < 7 ? 2 : 3]![1].push(t);
    }
    return buckets
      .filter(([, list]) => list.length)
      .map(([name, list]) => h('li', { class: 'side-date-group' }, h('h2', { class: 'side-date' }, name), h('ul', { class: 'side-list' }, ...list.map(threadButton))));
  };

  // Search: a row that opens a field; typing narrows the chat lists to titles that contain the words.
  let filterText = '';
  const filterWrap = $('#side-filter-wrap');
  const filterBox = $<HTMLInputElement>('#side-filter');
  const searchRow = $('#side-search');
  searchRow.addEventListener('click', () => {
    const open = filterWrap.hidden;
    filterWrap.hidden = !open;
    searchRow.setAttribute('aria-expanded', String(open));
    if (open) filterBox.focus();
    else {
      filterBox.value = '';
      filterText = '';
      void renderHistory();
    }
  });
  filterBox.addEventListener('input', () => {
    filterText = filterBox.value.trim().toLowerCase();
    void renderHistory();
  });
  filterBox.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') searchRow.click();
  });

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
    const gen = store.generation;
    const everyChat = (await listThreads()).filter((t) => t.messages.length);
    const all = filterText ? everyChat.filter((t) => (t.title || '').toLowerCase().includes(filterText)) : everyChat;
    projectsNow = await store.projects().catch(() => [] as Project[]);
    const artifacts = await store.artifacts().catch(() => [] as Artifact[]);
    if (gen !== store.generation) return; // a switch happened while this was reading: the next render is the right one

    // Pinned: pinned projects, then pinned chats that are not already inside a project.
    const pinnedProjects = projectsNow.filter((p) => p.pinned);
    const pinnedChats = all.filter((t) => t.pinned);
    $('#pinned-list').replaceChildren(
      ...pinnedProjects.map((p) => projectItem(p, everyChat, s)),
      ...pinnedChats.map(threadButton),
    );
    $('#side-pinned').hidden = pinnedProjects.length + pinnedChats.length === 0;

    // Projects (the pinned ones are listed again here: Pinned is a shortcut, not a move).
    $('#project-list').replaceChildren(...projectsNow.map((p) => projectItem(p, everyChat, s)));

    // Loose chats: not pinned, not in a project. The one on screen is among them, marked as the current one.
    const loose = all.filter((t) => !t.pinned && !t.projectId);
    $('#history-list').replaceChildren(...groupedChats(loose, s));
    $('#side-chats').hidden = loose.length === 0;
    const none = loose.length + pinnedProjects.length + pinnedChats.length === 0;
    $('#chats-empty').hidden = !none;
    $('#chats-empty').textContent = filterText && none ? s.noMatches : s.chatsEmpty;

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
    const none = thread.messages.length === 0;
    if (none && tools.matches(':popover-open')) (tools as HTMLElement & { hidePopover(): void }).hidePopover();
    tools.hidden = none;
    $('#chat-menu').hidden = none;
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

  $('#pin-chat').addEventListener('click', () => void togglePin(thread));
  $('#chat-project').addEventListener('change', () => void moveToProject(thread, $<HTMLSelectElement>('#chat-project').value));
  $('#delete-chat').addEventListener('click', async () => {
    $('#chat-tools').hidePopover?.();
    await deleteThread(thread);
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
    $('#artifact-text').textContent = plainText(a.text); // saved before plain text was kept: shown plain too
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
        text: plainText(m.answer.text),
        citations: m.answer.citations,
        savedAt: Date.now(),
      });
      $('#toast').textContent = strings().answerSaved;
    } catch {
      $('#toast').textContent = strings().storageFailed;
    }
    void renderHistory();
  };

  const syncBusy = () => {
    log.setAttribute('aria-busy', String(inflight.size > 0));
    setBusy('send', inflight.size > 0); // a release reloads the page only when nothing is on its way
  };

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
    const stopper = new AbortController();
    try {
      // A question that was stopped is on its way again, under a fresh key: the gateway may still be working on the first try.
      const key = m.hint === 'stopped' ? `${m.id}.${Date.now().toString(36)}` : m.id;
      delete m.error;
      delete m.hint;
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
        // After a while the person is told it is slow and can stop it: the question stays on this device, unanswered.
        slow = setTimeout(() => {
          const stop = h('button', { type: 'button', class: 'btn stop-answer' }, s.stop);
          stop.addEventListener('click', () => stopper.abort());
          pending?.append(h('p', { class: 'note' }, s.slow), stop);
        }, SLOW_AFTER_MS);
      }

      let res = await client.ask(
        { messages: contextFor(th, m), scope: m.scope === 'community' ? 'community' : GENERAL },
        { idempotencyKey: key, signal: stopper.signal },
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

      if (stopper.signal.aborted && !res.ok) {
        // The person stopped it and nothing came back: the question stays here, not sent again by itself (it is not queued),
        // and can be sent now or discarded. (An answer that did arrive in the same moment is shown as usual.)
        m.status = 'local';
        m.hint = 'stopped';
        delete m.error;
        await save(th);
        if (shown()) {
          mount(m);
          input.focus();
        }
        return;
      }

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
    // From here until the question is stored and delivered, a release must not reload the page: clearing the box below
    // would otherwise make the page look idle for a moment before the question is marked as on its way.
    setBusy('ask', true);
    try {
      const m: StoredMessage = { id: newId(), role: 'user', text: clean, at: Date.now(), scope: GENERAL, status: 'sent' };
      // Files and voice notes are written to this device with the question and go no further: only `clean` is ever sent.
      const added = attach.take();
      if (added.length) {
        try {
          for (const f of added) await store.putFile({ id: f.id, kind: f.kind, name: f.name, type: f.type, size: f.size, blob: f.blob, threadId: thread.id, at: m.at });
          m.attachments = added.map(({ id, kind, name, type, size }) => ({ id, kind, name, type, size }));
        } catch {
          // All or none: a half-saved set would leave files that no message shows.
          for (const f of added) void store.removeFile(f.id).catch(() => undefined);
          $('#toast').textContent = strings().storageFailed;
        }
      }
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
    } finally {
      setBusy('ask', false);
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
        location.replace('/auth/login');
        return;
      }
    }
    (go.disabled || go.hidden ? $('#auth-title') : go).focus();
  }

  /**
   * Sign out. For a Mukoko account the messages STAY on this device by default (they are this person's, and are kept in
   * their own store); a choice in the dialog also deletes them. Either way the screen leaves the chat at once, without
   * waiting on the network, and nothing of this person is left in memory for the next one.
   */
  const signOutDialog = $<HTMLDialogElement>('#signout-dialog');
  async function finishSignOut(alsoDelete: boolean) {
    const ended = Promise.resolve(auth.signOut());
    // The screen leaves the chat FIRST, whatever happens to the storage below: a failure there must never leave the
    // previous person's chat showing on a phone that is being handed over.
    epoch += 1;
    clearTimeout(retryTimer);
    live.clear();
    thread = fresh();
    rebuild();
    syncAuth();
    showAuth();
    const note = $('#signin-note');
    note.textContent = alsoDelete ? strings().signedOutCleared : strings().signedOutKeptNote;
    note.hidden = false;
    try {
      // Delete clears the person's own store (the one delete function); either way the app then lets go of it.
      if (alsoDelete) await deleteMessagesFromDevice();
      await releaseStore();
    } catch {
      /* the screen is already clear; a storage fault does not bring the chat back */
    }
    await ended;
    syncAuth();
  }
  $('#signout').addEventListener('click', async () => {
    closeAccount();
    if (auth.kind === 'mukoko') {
      $<HTMLInputElement>('#signout-delete').checked = false; // keeping is the default, every time
      signOutDialog.showModal();
      return;
    }
    // Developer-key mode: removing the key is all there is to it.
    await Promise.resolve(auth.signOut());
    syncAuth();
    showAuth();
  });
  $('#signout-cancel').addEventListener('click', () => signOutDialog.close());
  $('#signout-confirm').addEventListener('click', () => {
    const alsoDelete = $<HTMLInputElement>('#signout-delete').checked;
    signOutDialog.close();
    void finishSignOut(alsoDelete);
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
      location.assign('/auth/login');
    });
  }

  // ---- controls ------------------------------------------------------------
  const sendBtn = $<HTMLButtonElement>('#send');
  // Attachments load on first use (a tap on "+" or the microphone): most questions never need the code, and the first load stays small.
  let attachImpl: Attach | null = null;
  const attach = {
    take: () => attachImpl?.take() ?? [],
    clear: () => attachImpl?.clear(),
    refresh: () => attachImpl?.refresh(),
  };
  $('#mic').hidden = !(typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia);
  for (const id of ['#plus', '#mic']) {
    const button = $(id);
    const loadThenRepeat = async (e: Event) => {
      if (attachImpl) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      button.removeEventListener('click', loadThenRepeat, true);
      const { initAttach } = await import('./attach');
      attachImpl ??= initAttach(document, { strings, say: (text) => ($('#toast').textContent = text), newId });
      button.click(); // the tap that loaded it is now handled by it
    };
    button.addEventListener('click', loadThenRepeat, true);
  }
  const autosize = () => {
    setBusy('draft', input.value.trim() !== ''); // text in the question box is not reloaded away by a release
    sendBtn.disabled = input.value.trim() === ''; // the round send button is muted until there is something to send
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
    if (filterText) searchRow.click(); // a new chat starts with the whole list, not a search for the last one
    showSection('chat'); // a new chat is a chat: the drawer's next opening shows the chats again
    attach.clear();
    if (thread.messages.length) {
      thread = fresh();
      rebuild();
      void renderHistory();
    }
    input.focus();
  });

  /**
   * Point the app at the signed-in person's own store, once their token says who they are. The first person to sign in on a
   * device that held chats from before stores were per person keeps them (they move into this person's store); anyone
   * else starts empty. Everything on screen is rebuilt from the new store.
   */
  async function bindUser(): Promise<void> {
    if (auth.kind !== 'mukoko') return;
    const sub = subjectOf(auth.getKey());
    if (!sub) return; // offline with only the hint: the remembered store (or the unowned one) stays
    const key = await userKeyOf(sub);
    rememberUser(key);
    if (store.key === key) return;
    epoch += 1; // nothing in flight may write into the other store
    clearTimeout(retryTimer);
    await store.switchTo(key, store.key === null);
    live.clear();
    const all = await listThreads();
    saved.splice(0, saved.length, ...all);
    thread = all.find((t) => t.messages.length) ?? fresh();
    rebuild();
    void renderHistory();
  }

  /**
   * Let go of the current person: stop everything that could still write for them, empty the screen and the memory, and
   * point at the unowned store (empty once chats have been adopted). Their messages stay in their own store, on the device.
   */
  async function releaseStore(): Promise<void> {
    epoch += 1;
    clearTimeout(retryTimer);
    live.clear();
    saved.splice(0, saved.length);
    thread = fresh();
    rebuild();
    showSection('chat');
    rememberUser(null);
    await store.switchTo(null);
    live.clear();
    void renderHistory();
  }

  /** Take everything this device holds of the current store off it. The ONE delete: Delete history and sign-out both use it. */
  async function deleteMessagesFromDevice() {
    await wipeHistory();
  }

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
    attach.clear();
    await deleteMessagesFromDevice();
    $('#toast').textContent = strings().deleted;
    input.focus();
  });

  const langSelect = $<HTMLSelectElement>('#lang');
  langSelect.value = lang;
  langSelect.addEventListener('change', async () => {
    if (!isLanguage(langSelect.value)) return;
    const next = langSelect.value;
    try {
      await loadStrings(next);
      if (langSelect.value !== next) return; // a newer choice was made while this one loaded
    } catch {
      if (langSelect.value !== next) return;
      // The words could not be fetched (no connection and not yet cached): stay in the language that is showing.
      langSelect.value = lang;
      $('#toast').textContent = strings().languageUnavailable;
      return;
    }
    lang = next;
    saveLanguage(lang);
    applyStrings(document, lang);
    attach.refresh();
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
  if (languageFailed) $('#toast').textContent = strings().languageUnavailable;
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
    startup = (offlineMode && auth.signedIn() ? Promise.resolve(true) : auth.refresh()).then(async () => {
      await bindUser().catch(() => undefined);
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
      } else {
        // The session is gone: whoever's store this device had open is let go of before the sign-in is shown.
        if (store.key) await releaseStore().catch(() => undefined);
        showAuth(true);
      }
      syncAuth();
      afterAuth();
    });
  } else {
    if (auth.signedIn()) setView('app');
    else showAuth();
    afterAuth();
  }
}
