/**
 * The command menu (issue #329): Ctrl/Cmd+K opens it as a palette anywhere in the chat, and "/" at the start of an empty
 * question box opens the same commands as a list above the box. Every command is something the chat could already do (a
 * button somewhere in the drawer, the top bar or Settings): this only puts them one keystroke away. Nothing here talks to
 * the network. Loaded on first use, so the chat's first load does not carry it.
 *
 * Keyboard: Up and Down move, Enter runs, Escape closes (and leaves what was typed). Both lists are the WAI-ARIA listbox
 * pattern with aria-activedescendant, so focus stays in the field being typed in.
 */
import { h, plainText } from './render';
import { LANGUAGES, type Strings } from './strings';
import type { Store, Thread } from './store';
import type { Language } from './types';

export interface CommandHost {
  strings(): Strings;
  thread(): Thread;
  store: Pick<Store, 'skills'>;
  skillsOn(): string[];
  setSkillsOn(ids: string[]): Promise<void>;
  offlineMode(): boolean;
  /** Open a section of the session list (opening the slide-over on a phone). */
  openSection(name: 'chat' | 'projects' | 'artifacts' | 'plugins'): void;
  setLanguage(lang: Language): void;
  setTheme(theme: 'dark' | 'light' | null): void;
  say(text: string): void;
  input: HTMLTextAreaElement;
}

interface Command {
  label: string;
  hint?: string;
  run(): void | Promise<void>;
}

const el = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel);
const shown = (sel: string) => {
  const b = el(sel);
  return !!b && !b.hidden;
};
const press = (sel: string) => () => el(sel)?.click();

/** Every command that applies right now. `only: 'skills'` is the list the mode chip opens. */
export async function commandsFor(host: CommandHost, only?: 'skills'): Promise<Command[]> {
  const s = host.strings();
  const th = host.thread();
  const has = th.messages.length > 0;
  const skills: Command[] = [];
  try {
    const [{ allSkills, SKILLS_ON_MAX }, { parseSkillMd }] = await Promise.all([import('./skills'), import('./skill')]);
    const on = host.skillsOn();
    for (const k of await allSkills(host.store)) {
      const p = parseSkillMd(k.skillMd);
      const name = p.ok ? p.skill.name : k.id;
      const isOn = on.includes(k.id);
      skills.push({
        label: name,
        hint: `${k.scope === 'platform' ? s.skillGeneral : s.skillPersonal} · ${isOn ? s.offlineModeOn : s.offlineModeOff}`,
        run: async () => {
          if (!isOn && on.length >= SKILLS_ON_MAX) return host.say(s.skillsMax.replace('{max}', String(SKILLS_ON_MAX)));
          await host.setSkillsOn(isOn ? on.filter((id) => id !== k.id) : [...on, k.id]);
        },
      });
    }
  } catch {
    /* the skills could not be read: the rest of the menu still works */
  }
  const manage = { label: s.skillsTab, hint: s.navPlugins, run: () => host.openSection('plugins') };
  if (only === 'skills') return [...skills, ...(el('[data-section="plugins"]') ? [manage] : [])];
  const out: Command[] = [
    { label: s.newChat, run: press('#new-chat button') },
    {
      label: s.searchChats,
      run: () => {
        host.openSection('chat');
        if (el('#side-search')?.getAttribute('aria-expanded') !== 'true') el('#side-search')?.click();
        el('#side-filter')?.focus();
      },
    },
    ...skills,
    ...(el('[data-section="plugins"]') ? [manage] : []),
    { label: s.projects, run: () => host.openSection('projects') },
    { label: s.artifacts, run: () => host.openSection('artifacts') },
  ];
  if (has) {
    out.push(
      { label: th.pinned ? s.unpin : s.pin, run: press('#pin-chat') },
      { label: s.exportChat, hint: '.txt', run: () => exportChat(th, s) },
      { label: s.deleteChat, run: press('#delete-chat') },
    );
  }
  out.push({ label: s.offlineMode, hint: host.offlineMode() ? s.offlineModeOn : s.offlineModeOff, run: press('#offline-mode') });
  for (const [code, { label }] of Object.entries(LANGUAGES)) out.push({ label, hint: s.language, run: () => host.setLanguage(code as Language) });
  out.push(
    { label: s.themeDark, run: () => host.setTheme('dark') },
    { label: s.themeLight, run: () => host.setTheme('light') },
    { label: s.themeDevice, run: () => host.setTheme(null) },
  );
  if (matchMedia('(min-width: 64rem)').matches) out.push({ label: s.collapseChats, run: press('#side-toggle') });
  out.push({ label: s.settings, run: press('#open-settings') });
  if (shown('#install')) out.push({ label: s.install, run: press('#install') });
  if (shown('#signout')) out.push({ label: el('#signout')!.textContent ?? s.signOut, run: press('#signout') });
  out.push({ label: s.disclaimerLink, run: () => location.assign('/lite/disclaimer/') });
  return out;
}

/** The open chat as plain words in a text file, saved from this device. Nothing is sent anywhere. */
function exportChat(th: Thread, s: Strings) {
  const lines = [th.title || s.appName, ''];
  for (const m of th.messages) {
    lines.push(`${m.role === 'user' ? s.you : s.shamwari}:`, m.role === 'user' ? m.text : plainText(m.text));
    for (const c of m.answer?.citations ?? []) lines.push(`- ${c.heading ? `${c.heading}, ${c.title}` : c.title}${c.url ? ` (${c.url})` : ''}`);
    lines.push('');
  }
  const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain' }));
  const name = `${(th.title || 'shamwari').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'shamwari'}.txt`;
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** A listbox of commands, narrowed by a query, with one active option. */
class List {
  readonly ul: HTMLUListElement;
  private all: Command[] = [];
  private shown: Command[] = [];
  private active = 0;
  constructor(
    id: string,
    label: string,
    private field: HTMLElement,
    private onRun: (c: Command) => void,
    /** The most options shown at once (the slash menu shows a few and never scrolls; typing narrows it). */
    private max = Infinity,
  ) {
    this.ul = h('ul', { id, class: 'cmd-list', role: 'listbox', 'aria-label': label });
    // A press on an option must not take focus from the field being typed in.
    this.ul.addEventListener('mousedown', (e) => e.preventDefault());
  }
  set(all: Command[]) {
    this.all = all;
  }
  get count() {
    return this.shown.length;
  }
  filter(q: string, empty: string) {
    const words = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
    this.shown = this.all.filter((c) => words.every((w) => `${c.label} ${c.hint ?? ''}`.toLowerCase().includes(w))).slice(0, this.max);
    this.active = 0;
    this.ul.replaceChildren(
      ...(this.shown.length
        ? this.shown.map((c, i) => {
            const li = h('li', { id: `${this.ul.id}-${i}`, role: 'option', 'aria-selected': 'false' }, h('span', {}, c.label), c.hint ? h('span', { class: 'cmd-hint' }, c.hint) : null);
            li.addEventListener('click', () => this.onRun(c));
            li.addEventListener('mousemove', () => this.select(i));
            return li;
          })
        : [h('li', { class: 'cmd-empty', role: 'presentation' }, empty)]),
    );
    this.select(0);
  }
  select(i: number) {
    if (!this.shown.length) {
      this.field.removeAttribute('aria-activedescendant');
      return;
    }
    this.active = (i + this.shown.length) % this.shown.length;
    this.ul.querySelectorAll('[role="option"]').forEach((o, k) => o.setAttribute('aria-selected', String(k === this.active)));
    const on = this.ul.children[this.active] as HTMLElement;
    this.field.setAttribute('aria-activedescendant', on.id);
    on.scrollIntoView({ block: 'nearest' });
  }
  /** Up, Down and Enter. True when the key was the list's. */
  key(e: KeyboardEvent): boolean {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.select(this.active + (e.key === 'ArrowDown' ? 1 : -1));
      return true;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && this.shown.length) {
      e.preventDefault();
      this.onRun(this.shown[this.active]!);
      return true;
    }
    return false;
  }
}

// ---- the palette (Ctrl/Cmd+K) --------------------------------------------------------------------------------------

let dialog: HTMLDialogElement | null = null;
let palette: List | null = null;
let field: HTMLInputElement | null = null;

export async function openPalette(host: CommandHost, only?: 'skills'): Promise<void> {
  closeSlash(host);
  const s = host.strings();
  if (!dialog) {
    field = h('input', { type: 'text', role: 'combobox', 'aria-expanded': 'true', 'aria-controls': 'cmd-list', 'aria-autocomplete': 'list', autocomplete: 'off', spellcheck: 'false' });
    palette = new List('cmd-list', '', field, (c) => {
      dialog!.close();
      void c.run();
    });
    dialog = h('dialog', { class: 'palette' }, field, palette.ul);
    field.addEventListener('input', () => palette!.filter(field!.value, host.strings().commandsEmpty));
    field.addEventListener('keydown', (e) => palette!.key(e));
    // A press on the dim edge closes it.
    dialog.addEventListener('click', (e) => e.target === dialog && dialog!.close());
    document.body.append(dialog);
  }
  if (dialog.open) return;
  dialog.setAttribute('aria-label', s.commands);
  palette!.ul.setAttribute('aria-label', s.commands);
  field!.setAttribute('aria-label', s.commandPlaceholder);
  field!.placeholder = s.commandPlaceholder;
  field!.value = '';
  palette!.set(await commandsFor(host, only));
  palette!.filter('', s.commandsEmpty);
  dialog.showModal();
  field!.focus();
}

// ---- the slash menu ("/" at the start of the question box) ---------------------------------------------------------

let slashBox: HTMLElement | null = null;
let slash: List | null = null;
let dismissed: string | null = null;
let loading = 0;

const slashOpen = () => !!slashBox && !slashBox.hidden;

export function closeSlash(host: CommandHost): void {
  if (!slashOpen()) return;
  slashBox!.hidden = true;
  for (const a of ['aria-controls', 'aria-activedescendant', 'aria-autocomplete', 'aria-expanded']) host.input.removeAttribute(a);
}

/** Called on every change to the question box: "/" and a query at the start of it, on one line, shows the commands. */
export async function onSlashInput(host: CommandHost): Promise<void> {
  const v = host.input.value;
  if (!v.startsWith('/') || v.includes('\n') || v === dismissed) {
    if (!v.startsWith('/')) dismissed = null;
    closeSlash(host);
    return;
  }
  const s = host.strings();
  if (!slashBox) {
    slash = new List('slash-list', '', host.input, (c) => {
      closeSlash(host);
      host.input.value = '';
      host.input.dispatchEvent(new Event('input', { bubbles: true }));
      void c.run();
    }, 6);
    slashBox = h('div', { class: 'slash-menu', hidden: true }, slash.ul);
    document.querySelector('.dock')?.append(slashBox);
  }
  slash!.ul.setAttribute('aria-label', s.commands);
  if (!slashOpen()) {
    const ticket = ++loading;
    const list = await commandsFor(host);
    if (ticket !== loading || !host.input.value.startsWith('/')) return;
    slash!.set(list);
    slashBox.hidden = false;
    host.input.setAttribute('aria-controls', 'slash-list');
    host.input.setAttribute('aria-autocomplete', 'list');
  }
  slash!.filter(host.input.value.slice(1), s.commandsEmpty);
}

/** The question box's keys while the slash menu is open. True when the menu took the key (Enter then does not send). */
export function onSlashKey(host: CommandHost, e: KeyboardEvent): boolean {
  if (!slashOpen()) return false;
  if (e.key === 'Escape') {
    e.preventDefault();
    dismissed = host.input.value;
    closeSlash(host);
    return true;
  }
  if (slash!.key(e)) return true;
  // Enter with nothing matching: the text is a question after all, and is sent as one.
  if (e.key === 'Enter') closeSlash(host);
  return false;
}
