/**
 * SKILL.md: read, check and write one Agent Skill (https://agentskills.io).
 *
 * The rules are copied from the specification at source, github.com/agentskills/agentskills,
 * docs/specification.mdx at commit 83021e2be457a9b6679148719c1f6074f0ad975e, and its reference
 * validator in the same commit (skills-ref/src/skills_ref/validator.py), which is what the spec
 * tells authors to validate with:
 *
 * - The file starts with YAML frontmatter between two `---` lines, then a Markdown body.
 * - `name` (required): 1-64 characters after NFKC normalisation; lowercase letters, digits and
 *   hyphens only; does not start or end with a hyphen; no `--`. (The spec's prose says a-z and
 *   0-9; its reference validator accepts any lowercase Unicode letter. This follows the validator.)
 *   The spec also asks that it match the skill's folder name: there is no folder on a phone, so an
 *   exported SKILL.md belongs in a folder named after `name` (docs/chat-app.md).
 * - `description` (required): 1-1024 characters, not blank.
 * - `license` (optional), `compatibility` (optional, 1-500 characters), `metadata` (optional, a
 *   map of string keys to string values), `allowed-tools` (optional, experimental, a string).
 * - No other top-level field (the reference validator refuses unknown fields).
 *
 * Shamwari adds one limit of its own, not the spec's: the body (the instructions) is at most
 * BODY_MAX characters, because a skill that is turned on travels with every question
 * (gateway/src/skills.ts holds the same number).
 *
 * The YAML reader is a small subset, not a YAML library (the chat has no dependencies and a
 * 2G budget): `key: value` lines with plain, 'single' or "double" quoted values, `|` and `>`
 * block values, plain values that continue on indented lines, `#` comments, and one level of
 * `metadata:` map. Anything else is refused with the line it is on, never guessed at.
 */

export const NAME_MAX = 64;
export const DESCRIPTION_MAX = 1024;
export const COMPATIBILITY_MAX = 500;
/** Shamwari's own limit on the instructions, not the spec's. Kept equal to SKILL_BODY_MAX in gateway/src/skills.ts. */
export const BODY_MAX = 12_000;

const FIELDS = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'] as const;
type Field = (typeof FIELDS)[number];

export interface SkillFields {
  name: string;
  description: string;
  /** The Markdown after the frontmatter: the instructions. */
  body: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  allowedTools?: string;
}

/** What is wrong, as a code the UI words in the chosen language. `field` says which input it belongs to. */
export type SkillProblem =
  | { field: 'file'; code: 'no_frontmatter' | 'unclosed' }
  | { field: 'file'; code: 'bad_yaml'; line: number }
  | { field: 'file'; code: 'unknown_field'; name: string }
  | { field: 'name' | 'description'; code: 'missing' }
  | { field: 'name' | 'description' | 'compatibility' | 'body'; code: 'too_long'; max: number; length: number }
  | { field: 'name'; code: 'name_case' | 'name_hyphen_end' | 'name_double_hyphen' | 'name_chars' }
  | { field: 'compatibility'; code: 'missing' }
  | { field: 'metadata'; code: 'not_map' };

export type Parsed = { ok: true; skill: SkillFields } | { ok: false; problems: SkillProblem[]; partial?: Partial<SkillFields> };

/** The name as the spec compares it: NFKC, trimmed. */
export const normaliseName = (name: string): string => name.trim().normalize('NFKC');

/** Check the fields against the spec. An empty list means the skill is valid. */
export function validateSkill(f: Partial<SkillFields>): SkillProblem[] {
  const out: SkillProblem[] = [];
  const name = normaliseName(f.name ?? '');
  if (!name) out.push({ field: 'name', code: 'missing' });
  else {
    // Length is counted in characters (code points), as Python's len() counts them.
    const length = [...name].length;
    if (length > NAME_MAX) out.push({ field: 'name', code: 'too_long', max: NAME_MAX, length });
    if (name !== name.toLowerCase()) out.push({ field: 'name', code: 'name_case' });
    if (name.startsWith('-') || name.endsWith('-')) out.push({ field: 'name', code: 'name_hyphen_end' });
    if (name.includes('--')) out.push({ field: 'name', code: 'name_double_hyphen' });
    if (!/^[\p{L}\p{N}-]+$/u.test(name)) out.push({ field: 'name', code: 'name_chars' });
  }
  const description = f.description ?? '';
  if (!description.trim()) out.push({ field: 'description', code: 'missing' });
  else if ([...description].length > DESCRIPTION_MAX)
    out.push({ field: 'description', code: 'too_long', max: DESCRIPTION_MAX, length: [...description].length });
  if (f.compatibility !== undefined) {
    if (!f.compatibility.trim()) out.push({ field: 'compatibility', code: 'missing' });
    else if ([...f.compatibility].length > COMPATIBILITY_MAX)
      out.push({ field: 'compatibility', code: 'too_long', max: COMPATIBILITY_MAX, length: [...f.compatibility].length });
  }
  const body = f.body ?? '';
  if ([...body].length > BODY_MAX) out.push({ field: 'body', code: 'too_long', max: BODY_MAX, length: [...body].length });
  return out;
}

// ---- reading ---------------------------------------------------------------------------------------------

class YamlError extends Error {
  constructor(readonly line: number) {
    super('bad_yaml');
  }
}

const indentOf = (l: string) => l.length - l.trimStart().length;
const blank = (l: string) => l.trim() === '' || /^\s*#/.test(l);

/** One scalar on a single line: "double" (JSON-compatible escapes), 'single', or plain. */
function scalar(raw: string, line: number): string {
  const v = raw.trim();
  if (v.startsWith('"')) {
    const end = v.lastIndexOf('"');
    const rest = v.slice(end + 1).trim();
    if (end <= 0 || (rest && !rest.startsWith('#'))) throw new YamlError(line);
    try {
      return JSON.parse(v.slice(0, end + 1)) as string;
    } catch {
      throw new YamlError(line);
    }
  }
  if (v.startsWith("'")) {
    const m = /^'((?:[^']|'')*)'\s*(?:#.*)?$/.exec(v);
    if (!m) throw new YamlError(line);
    return m[1]!.replace(/''/g, "'");
  }
  const plain = v.replace(/\s+#.*$/, '');
  // Flow collections, anchors, tags and the like are not plain text: refused, not guessed.
  if (/^[[\]{}&*!|>%@`,]/.test(plain)) throw new YamlError(line);
  // A ": " inside a plain value is a mapping in YAML, and other readers would refuse the file.
  if (/:\s/.test(plain) || plain.endsWith(':')) throw new YamlError(line);
  return plain;
}

/** A `|` or `>` block: the indented lines after the key. Returns the text and the next line to read. */
function block(lines: string[], from: number, header: string, line: number): [string, number] {
  const m = /^([|>])([+-]?)\s*(?:#.*)?$/.exec(header.trim());
  if (!m) throw new YamlError(line);
  const [, style, chomp] = m;
  let i = from;
  const body: string[] = [];
  let indent = -1;
  while (i < lines.length) {
    const l = lines[i]!;
    if (l.trim() === '') {
      body.push('');
      i++;
      continue;
    }
    const n = indentOf(l);
    if (n === 0) break;
    if (indent < 0) indent = n;
    if (n < indent) break;
    body.push(l.slice(indent));
    i++;
  }
  // Trailing blank lines belong to the chomping rule, not the text.
  let trailing = 0;
  while (body.length && body[body.length - 1] === '') {
    body.pop();
    trailing++;
  }
  let text =
    style === '|'
      ? body.join('\n')
      : body.reduce((acc, l, k) => (k === 0 ? l : l === '' ? `${acc}\n` : acc.endsWith('\n') ? acc + l : `${acc} ${l}`), '');
  if (chomp === '+') text += '\n'.repeat(trailing + (body.length ? 1 : 0));
  else if (chomp !== '-' && body.length) text += '\n';
  return [text, i];
}

/** Read the frontmatter: a map of the top-level keys to strings, and `metadata` to a map. */
function readFrontmatter(src: string, firstLine: number): Record<string, string | Record<string, string>> {
  const lines = src.split('\n');
  const out: Record<string, string | Record<string, string>> = {};
  let i = 0;
  while (i < lines.length) {
    const l = lines[i]!;
    const at = firstLine + i;
    if (blank(l)) {
      i++;
      continue;
    }
    if (indentOf(l) !== 0) throw new YamlError(at);
    const m = /^([A-Za-z0-9_-]+)\s*:(?:\s+(.*)|\s*)$/.exec(l.trimEnd());
    if (!m) throw new YamlError(at);
    const key = m[1]!;
    const rest = (m[2] ?? '').trim();
    if (key in out) throw new YamlError(at); // a duplicate key is an error in YAML, not "the last one wins"
    i++;
    if (rest.startsWith('|') || rest.startsWith('>')) {
      const [text, next] = block(lines, i, rest, at);
      out[key] = text;
      i = next;
      continue;
    }
    if (rest === '' || rest.startsWith('#')) {
      // Either an empty value or a nested map (metadata) on the indented lines below.
      const map: Record<string, string> = {};
      let nested = false;
      while (i < lines.length && (blank(lines[i]!) || indentOf(lines[i]!) > 0)) {
        const n = lines[i]!;
        if (blank(n)) {
          i++;
          continue;
        }
        const kv = /^\s+("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s"'#:][^:]*?)\s*:(?:\s+(.*)|\s*)$/.exec(n.trimEnd());
        if (!kv) throw new YamlError(firstLine + i);
        const k = kv[1]!.startsWith('"') || kv[1]!.startsWith("'") ? scalar(kv[1]!, firstLine + i) : kv[1]!;
        if (k in map) throw new YamlError(firstLine + i);
        map[k] = kv[2] === undefined ? '' : scalar(kv[2], firstLine + i);
        nested = true;
        i++;
      }
      out[key] = nested ? map : '';
      continue;
    }
    let value = scalar(rest, at);
    // A plain value may go on over indented lines; they fold into one line with spaces.
    if (!rest.startsWith('"') && !rest.startsWith("'")) {
      while (i < lines.length && !blank(lines[i]!) && indentOf(lines[i]!) > 0) {
        value = `${value} ${scalar(lines[i]!, firstLine + i)}`;
        i++;
      }
    }
    out[key] = value;
  }
  return out;
}

/** Read a SKILL.md and check it. On failure `partial` holds whatever could be read, so a form can show it for fixing. */
export function parseSkillMd(text: string): Parsed {
  const src = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  if (lines[0]?.trimEnd() !== '---') return { ok: false, problems: [{ field: 'file', code: 'no_frontmatter' }] };
  const close = lines.findIndex((l, k) => k > 0 && l.trimEnd() === '---');
  if (close < 0) return { ok: false, problems: [{ field: 'file', code: 'unclosed' }] };
  const body = lines
    .slice(close + 1)
    .join('\n')
    .replace(/^\n+/, '')
    .trimEnd();
  let fm: Record<string, string | Record<string, string>>;
  try {
    fm = readFrontmatter(lines.slice(1, close).join('\n'), 2);
  } catch (e) {
    return { ok: false, problems: [{ field: 'file', code: 'bad_yaml', line: e instanceof YamlError ? e.line : 1 }], partial: { body } };
  }
  const problems: SkillProblem[] = [];
  for (const k of Object.keys(fm)) if (!(FIELDS as readonly string[]).includes(k)) problems.push({ field: 'file', code: 'unknown_field', name: k });
  const str = (k: Field): string | undefined => (typeof fm[k] === 'string' ? (fm[k] as string) : undefined);
  if (fm.metadata !== undefined && typeof fm.metadata !== 'object') problems.push({ field: 'metadata', code: 'not_map' });
  for (const k of ['name', 'description', 'license', 'compatibility', 'allowed-tools'] as const) {
    // A map where a string belongs (`name:` followed by indented keys) is not a string.
    if (typeof fm[k] === 'object') problems.push(k === 'name' || k === 'description' ? { field: k, code: 'missing' } : { field: 'file', code: 'bad_yaml', line: 1 });
  }
  const skill: SkillFields = {
    name: normaliseName(str('name') ?? ''),
    description: (str('description') ?? '').trim(),
    body,
    ...(str('license') !== undefined ? { license: str('license') } : {}),
    ...(str('compatibility') !== undefined ? { compatibility: str('compatibility') } : {}),
    ...(typeof fm.metadata === 'object' ? { metadata: fm.metadata } : {}),
    ...(str('allowed-tools') !== undefined ? { allowedTools: str('allowed-tools') } : {}),
  };
  const fieldProblems = validateSkill({ ...skill, name: str('name') ?? '', description: str('description') ?? '' });
  // A map in name or description was already reported as missing.
  for (const p of fieldProblems) if (!problems.some((q) => q.field === p.field && q.code === p.code)) problems.push(p);
  return problems.length ? { ok: false, problems, partial: skill } : { ok: true, skill };
}

// ---- writing ---------------------------------------------------------------------------------------------

/** A double-quoted YAML scalar. JSON's string escapes are all valid YAML escapes, so JSON.stringify writes one. */
const quote = (v: string) => JSON.stringify(v);
const key = (k: string) => (/^[A-Za-z0-9_.-]+$/.test(k) ? k : quote(k));

/** Write a SKILL.md that parseSkillMd reads back to the same fields (and that any YAML reader can read). */
export function writeSkillMd(f: SkillFields): string {
  const name = normaliseName(f.name);
  // A valid name is letters, digits and hyphens, which YAML reads as plain text; anything else is quoted.
  const out = ['---', `name: ${/^[\p{L}\p{N}][\p{L}\p{N}-]*$/u.test(name) ? name : quote(name)}`, `description: ${quote(f.description.trim())}`];
  if (f.license !== undefined) out.push(`license: ${quote(f.license)}`);
  if (f.compatibility !== undefined) out.push(`compatibility: ${quote(f.compatibility)}`);
  if (f.metadata && Object.keys(f.metadata).length) {
    out.push('metadata:');
    for (const [k, v] of Object.entries(f.metadata)) out.push(`  ${key(k)}: ${quote(v)}`);
  }
  if (f.allowedTools !== undefined) out.push(`allowed-tools: ${quote(f.allowedTools)}`);
  out.push('---');
  const body = f.body.trim();
  return `${out.join('\n')}\n${body ? `\n${body}\n` : ''}`;
}
