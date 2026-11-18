/**
 * The Skills tab: the person's Agent Skills (agentskills.io), a builder to write one, and import and export of SKILL.md
 * files. Loaded the first time the Plugins section is opened, with plugins.ts, so the chat's first load does not carry it.
 *
 * Everything here stays on this device (chat/store.ts, `skills`). Turning a skill on is per chat. What a question then
 * sends is decided in chat/skills.ts: a personal-scope skill never leaves the device (Rule 1, AGENTS.md).
 *
 * The form is checked live against the specification (chat/skill.ts): each field says what is wrong with it under it,
 * once it has been typed in, and Save moves focus to the first field that is still wrong instead of being disabled.
 */
import { h } from './render';
import { BODY_MAX, DESCRIPTION_MAX, NAME_MAX, normaliseName, parseSkillMd, validateSkill, writeSkillMd, type SkillFields, type SkillProblem } from './skill';
import { SKILLS_ON_MAX, allSkills } from './skills';
import type { SkillRecord, Store } from './store';
import type { Strings } from './strings';

/** How many skills can be on in one chat (the gateway takes at most three: gateway/src/skills.ts). */
export { SKILLS_ON_MAX };

export interface SkillsHost {
  store: Pick<Store, 'skills' | 'putSkill' | 'removeSkill'>;
  strings: () => Strings;
  /** The skills on in the open chat. */
  onInChat: () => readonly string[];
  setOnInChat: (ids: string[]) => Promise<void>;
  say: (text: string) => void;
  newId: () => string;
}

const fill = (t: string, v: Record<string, string | number>) => t.replace(/\{(\w+)\}/g, (_m, k: string) => String(v[k] ?? ''));

/** One problem, in the chosen language. */
export function problemText(p: SkillProblem, s: Strings): string {
  switch (p.code) {
    case 'missing':
      return s.skillErrMissing;
    case 'too_long':
      return fill(s.skillErrTooLong, { length: p.length, max: p.max });
    case 'name_case':
      return s.skillErrNameCase;
    case 'name_hyphen_end':
    case 'name_double_hyphen':
      return s.skillErrNameHyphen;
    case 'name_chars':
      return s.skillErrNameChars;
    case 'no_frontmatter':
    case 'unclosed':
      return s.skillErrHeader;
    case 'bad_yaml':
      return fill(s.skillErrYaml, { line: p.line });
    case 'unknown_field':
      return fill(s.skillErrField, { name: p.name });
    case 'not_map':
      return fill(s.skillErrField, { name: 'metadata' });
  }
}

/** A form's problems: the spec's, and one of the app's own (two skills with one name). */
type FormProblem = SkillProblem | { field: 'name'; code: 'taken' };

/** The name a stored skill has, read from its SKILL.md. */
const nameOf = (r: SkillRecord): string => {
  const p = parseSkillMd(r.skillMd);
  return p.ok ? p.skill.name : (p.partial?.name ?? '');
};

type Mode = { kind: 'new' } | { kind: 'edit'; record: SkillRecord; extras: Partial<SkillFields> } | { kind: 'import'; original: string; parsed: Partial<SkillFields> | null };

export function initSkills(root: Document, host: SkillsHost): { refresh(): void } {
  const panel = root.getElementById('tabpanel-skills')!;
  const s = () => host.strings();
  let records: SkillRecord[] = [];
  let mode: Mode | null = null;
  /** Fields the person has typed in: their problems are shown live. All of them are, once Save has been pressed. */
  const touched = new Set<string>();

  // ---- the static parts: the list, the two actions, the form -------------------------------------------------------
  const empty = h('p', { class: 'side-empty', id: 'skills-empty' });
  const list = h('ul', { class: 'side-list skill-list', id: 'skill-list' });
  const fileError = h('p', { class: 'small bad', id: 'skill-file-error', role: 'alert', hidden: true });
  const newBtn = h('button', { type: 'button', class: 'btn', id: 'skill-new', 'aria-expanded': 'false', 'aria-controls': 'skill-form' });
  const importBtn = h('button', { type: 'button', class: 'btn', id: 'skill-import' });
  const fileInput = h('input', { type: 'file', id: 'skill-file', accept: '.md,text/markdown,text/plain', hidden: true });

  const field = (id: string, control: HTMLInputElement | HTMLTextAreaElement, hint: boolean, count: boolean) => {
    const label = h('label', { for: id });
    const parts = [hint && `${id}-hint`, count && `${id}-count`, `${id}-err`].filter(Boolean).join(' ');
    control.id = id;
    control.setAttribute('aria-describedby', parts);
    const wrap = h(
      'div',
      { class: 'skill-field' },
      label,
      control,
      hint && h('p', { class: 'settings-hint', id: `${id}-hint` }),
      count && h('p', { class: 'settings-hint', id: `${id}-count` }),
      h('p', { class: 'small bad', id: `${id}-err`, hidden: true }),
    );
    return { wrap, label, control };
  };
  const name = field('skill-name', h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' }), true, false);
  const description = field('skill-description', h('textarea', { rows: '3' }), true, true);
  const body = field('skill-body', h('textarea', { rows: '8' }), false, true);

  // An imported skill's scope is chosen once, at import: personal unless the person says otherwise.
  const scopeLegend = h('legend', { id: 'skill-scope-legend' });
  const radio = (value: 'personal' | 'platform') => {
    const input = h('input', { type: 'radio', name: 'skill-scope', value, id: `skill-scope-${value}` });
    const text = h('span', {});
    return { row: h('label', { class: 'radio-row', for: `skill-scope-${value}` }, input, text), input, text };
  };
  const personal = radio('personal');
  const platform = radio('platform');
  const scopeSet = h('fieldset', { class: 'skill-scope', id: 'skill-scope' }, scopeLegend, h('div', { class: 'radio-group' }, personal.row, platform.row));

  const formTitle = h('h3', { id: 'skill-form-title', class: 'chats-title' });
  const formError = h('p', { class: 'small bad', id: 'skill-form-error', role: 'alert', hidden: true });
  const save = h('button', { type: 'submit', class: 'btn primary', id: 'skill-save' });
  const cancel = h('button', { type: 'button', class: 'btn', id: 'skill-cancel' });
  const form = h(
    'form',
    { id: 'skill-form', class: 'skill-form', novalidate: true, hidden: true, 'aria-labelledby': 'skill-form-title' },
    formTitle,
    formError,
    name.wrap,
    description.wrap,
    body.wrap,
    scopeSet,
    h('div', { class: 'row' }, save, cancel),
  );
  panel.replaceChildren(empty, list, fileError, h('div', { class: 'row skill-actions' }, newBtn, importBtn), fileInput, form);

  // ---- words ---------------------------------------------------------------------------------------------------------
  const words = () => {
    const t = s();
    empty.textContent = t.skillsEmpty;
    newBtn.textContent = t.newSkill;
    importBtn.textContent = t.importSkill;
    name.label.textContent = t.skillName;
    description.label.textContent = t.skillDescription;
    body.label.textContent = t.skillInstructions;
    root.getElementById('skill-name-hint')!.textContent = fill(t.skillNameHint, { max: NAME_MAX });
    root.getElementById('skill-description-hint')!.textContent = fill(t.skillDescriptionHint, { max: DESCRIPTION_MAX });
    scopeLegend.textContent = t.skillScope;
    personal.text.textContent = t.skillScopePersonal;
    platform.text.textContent = t.skillScopePlatform;
    save.textContent = t.saveSkill;
    cancel.textContent = t.cancel;
    formTitle.textContent = mode?.kind === 'edit' ? t.editSkill : mode?.kind === 'import' ? t.importSkill : t.newSkill;
  };

  // ---- live checking -------------------------------------------------------------------------------------------------
  const current = (): SkillFields => ({
    ...(mode?.kind === 'edit' ? mode.extras : mode?.kind === 'import' ? (mode.parsed ?? {}) : {}),
    name: name.control.value,
    description: description.control.value,
    body: body.control.value,
  });
  const problemsNow = (): FormProblem[] => {
    const f = current();
    const out: FormProblem[] = validateSkill(f).filter((p) => p.field === 'name' || p.field === 'description' || p.field === 'body');
    // Two skills with one name could not both be exported as the spec's folder of that name.
    const editing = mode?.kind === 'edit' ? mode.record.id : null;
    const n = normaliseName(f.name);
    if (n && records.some((r) => r.id !== editing && nameOf(r) === n)) out.push({ field: 'name', code: 'taken' });
    return out;
  };
  const text = (p: FormProblem) => (p.code === 'taken' ? s().skillErrNameTaken : problemText(p, s()));
  const check = (all = false): FormProblem[] => {
    const problems = problemsNow();
    for (const f of [name, description, body]) {
      const key = f.control.id.replace('skill-', '');
      const mine = problems.filter((p) => p.field === key);
      const show = (all || touched.has(key)) && mine.length > 0;
      const err = root.getElementById(`${f.control.id}-err`)!;
      err.hidden = !show;
      err.textContent = show ? mine.map(text).join(' ') : '';
      if (show) f.control.setAttribute('aria-invalid', 'true');
      else f.control.removeAttribute('aria-invalid');
    }
    root.getElementById('skill-description-count')!.textContent = `${[...description.control.value].length} / ${DESCRIPTION_MAX}`;
    root.getElementById('skill-body-count')!.textContent = `${[...body.control.value].length} / ${BODY_MAX}`;
    return problems;
  };
  for (const f of [name, description, body]) {
    f.control.addEventListener('input', () => {
      touched.add(f.control.id.replace('skill-', ''));
      check();
    });
  }

  // ---- the form ------------------------------------------------------------------------------------------------------
  const open = (m: Mode, fields: Partial<SkillFields>, problems: SkillProblem[] = []) => {
    mode = m;
    touched.clear();
    name.control.value = fields.name ?? '';
    description.control.value = fields.description ?? '';
    body.control.value = fields.body ?? '';
    scopeSet.hidden = m.kind !== 'import';
    personal.input.checked = true;
    platform.input.checked = false;
    const fileProblems = problems.filter((p) => p.field === 'file' || p.field === 'metadata');
    formError.hidden = fileProblems.length === 0;
    formError.textContent = fileProblems.map((p) => problemText(p, s())).join(' ');
    // An imported file's own problems are shown at once: the person did not type them.
    for (const p of problems) if (p.field !== 'file' && p.field !== 'metadata') touched.add(p.field);
    fileError.hidden = true;
    form.hidden = false;
    newBtn.setAttribute('aria-expanded', 'true');
    words();
    check();
    name.control.focus();
  };
  const close = (focus: HTMLElement = newBtn) => {
    mode = null;
    form.hidden = true;
    newBtn.setAttribute('aria-expanded', 'false');
    focus.focus();
  };

  newBtn.addEventListener('click', () => (form.hidden ? open({ kind: 'new' }, {}) : close()));
  cancel.addEventListener('click', () => close());
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!mode) return;
    const problems = check(true);
    if (problems.length) {
      const first = [name, description, body].find((f) => problems.some((p) => p.field === f.control.id.replace('skill-', '')));
      first?.control.focus();
      return;
    }
    const f = current();
    const now = Date.now();
    let record: SkillRecord;
    if (mode.kind === 'edit') {
      const old = parseSkillMd(mode.record.skillMd);
      const unchanged = old.ok && old.skill.name === normaliseName(f.name) && old.skill.description === f.description.trim() && old.skill.body === f.body.trim();
      record = { ...mode.record, skillMd: unchanged ? mode.record.skillMd : writeSkillMd(f), updatedAt: now };
    } else if (mode.kind === 'import') {
      // The file as it came, when it was valid and nothing was changed; otherwise written afresh from the fields.
      const as = parseSkillMd(mode.original);
      const unchanged = as.ok && as.skill.name === normaliseName(f.name) && as.skill.description === f.description.trim() && as.skill.body === f.body.trim();
      record = { id: host.newId(), source: 'plugin', scope: platform.input.checked ? 'platform' : 'personal', skillMd: unchanged ? mode.original : writeSkillMd(f), createdAt: now, updatedAt: now };
    } else {
      record = { id: host.newId(), source: 'personal', scope: 'personal', skillMd: writeSkillMd(f), createdAt: now, updatedAt: now };
    }
    try {
      await host.store.putSkill(record);
    } catch {
      host.say(s().storageFailed);
      return;
    }
    host.say(s().skillSaved);
    mode = null;
    form.hidden = true;
    newBtn.setAttribute('aria-expanded', 'false');
    await draw();
    (list.querySelector<HTMLElement>(`[data-skill="${CSS.escape(record.id)}"] [role="switch"]`) ?? newBtn).focus();
  });

  // ---- import and export ---------------------------------------------------------------------------------------------
  importBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    // A SKILL.md is text, and a small one; a large file is not read into memory.
    const content = file.size <= 1024 * 1024 ? await file.text().catch(() => '') : '';
    const parsed = parseSkillMd(content);
    if (parsed.ok) {
      open({ kind: 'import', original: content, parsed: parsed.skill }, parsed.skill);
      return;
    }
    const readable = parsed.partial && (parsed.partial.name || parsed.partial.description || parsed.partial.body);
    if (!readable) {
      // Nothing to put in a form: say why, beside the button that was pressed.
      fileError.textContent = parsed.problems.map((p) => problemText(p, s())).join(' ');
      fileError.hidden = false;
      importBtn.focus();
      return;
    }
    open({ kind: 'import', original: content, parsed: parsed.partial ?? null }, parsed.partial ?? {}, parsed.problems);
  });

  const exportSkill = (r: SkillRecord) => {
    // A SKILL.md belongs in a folder named after the skill (the spec); the file itself is always SKILL.md.
    const url = URL.createObjectURL(new Blob([r.skillMd], { type: 'text/markdown' }));
    const a = h('a', { href: url, download: 'SKILL.md' });
    root.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  // ---- the list ------------------------------------------------------------------------------------------------------
  const item = (r: SkillRecord): HTMLElement => {
    const t = s();
    const p = parseSkillMd(r.skillMd);
    const fields = p.ok ? p.skill : (p.partial ?? {});
    const label = fields.name || '…';
    const on = host.onInChat().includes(r.id);
    const kind = r.scope === 'personal' ? t.skillPersonal : r.source === 'platform' ? t.skillFromShamwari : t.skillGeneral;
    const toggle = h('button', { type: 'button', role: 'switch', class: 'btn skill-switch', 'aria-checked': String(on), 'aria-label': `${t.skillOn}: ${label}` }, t.skillOn);
    toggle.addEventListener('click', async () => {
      const ids = host.onInChat().filter((id) => records.some((x) => x.id === id));
      const next = ids.includes(r.id) ? ids.filter((id) => id !== r.id) : [...ids, r.id];
      if (next.length > SKILLS_ON_MAX) {
        host.say(fill(t.skillsMax, { max: SKILLS_ON_MAX }));
        return;
      }
      await host.setOnInChat(next);
      toggle.setAttribute('aria-checked', String(next.includes(r.id)));
    });
    const exportBtn = h('button', { type: 'button', class: 'btn', 'aria-label': `${t.exportSkill}: ${label}` }, t.exportSkill);
    exportBtn.addEventListener('click', () => exportSkill(r));
    const actions = h('div', { class: 'row' }, toggle, exportBtn);
    // Shamwari's own skills are read-only: they can be turned on and exported, not changed or deleted here.
    if (r.source !== 'platform') {
      const edit = h('button', { type: 'button', class: 'btn', 'aria-label': `${t.editSkill}: ${label}` }, t.editSkill);
      edit.addEventListener('click', () => {
        // The optional fields (licence, metadata, ...) are kept as they are: the form edits only the three.
        const extras: Partial<SkillFields> = { ...fields };
        delete extras.name;
        delete extras.description;
        delete extras.body;
        open({ kind: 'edit', record: r, extras }, fields, p.ok ? [] : p.problems);
      });
      const del = h('button', { type: 'button', class: 'btn danger', 'aria-label': `${t.deleteSkill}: ${label}` }, t.deleteSkill);
      del.addEventListener('click', async () => {
        if (!confirm(t.deleteSkillConfirm)) return;
        try {
          await host.store.removeSkill(r.id);
        } catch {
          host.say(t.storageFailed);
          return;
        }
        if (host.onInChat().includes(r.id)) await host.setOnInChat(host.onInChat().filter((id) => id !== r.id));
        if (mode?.kind === 'edit' && mode.record.id === r.id) close();
        await draw();
        newBtn.focus();
      });
      actions.append(edit, del);
    }
    return h(
      'li',
      { class: 'skill-item', 'data-skill': r.id },
      h('p', { class: 'skill-name' }, h('span', {}, label), h('span', { class: 'side-chip' }, kind)),
      fields.description ? h('p', { class: 'settings-hint skill-desc' }, fields.description) : null,
      actions,
    );
  };

  /** Read the skills again and draw the list. A failing store reads as none, never as a crash. */
  const draw = async () => {
    records = await allSkills(host.store).catch(() => [] as SkillRecord[]);
    words();
    list.replaceChildren(...records.map(item));
    list.hidden = records.length === 0;
    empty.hidden = records.length > 0;
  };

  void draw();
  return {
    refresh: () => {
      void draw();
      if (mode) check();
    },
  };
}
