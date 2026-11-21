// SKILL.md, read and checked against the Agent Skills specification
// (github.com/agentskills/agentskills, docs/specification.mdx and skills-ref/src/skills_ref/validator.py
// at 83021e2be457a9b6679148719c1f6074f0ad975e). The cases below are the spec's own examples where it has them.
import { describe, expect, it } from 'vitest';
import { BODY_MAX, COMPATIBILITY_MAX, DESCRIPTION_MAX, NAME_MAX, parseSkillMd, validateSkill, writeSkillMd, type SkillFields } from '../../src/chat/skill';

const md = (front: string, body = '# Steps\n\nDo the thing.') => `---\n${front}\n---\n\n${body}\n`;
const codes = (text: string) => {
  const r = parseSkillMd(text);
  return r.ok ? [] : r.problems.map((p) => `${p.field}:${p.code}`);
};

describe('a valid SKILL.md', () => {
  it('reads the spec\'s minimal example', () => {
    const r = parseSkillMd('---\nname: skill-name\ndescription: A description of what this skill does and when to use it.\n---\n');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.skill).toEqual({ name: 'skill-name', description: 'A description of what this skill does and when to use it.', body: '' });
  });

  it('reads the spec\'s example with optional fields, and the body', () => {
    const r = parseSkillMd(
      md('name: pdf-processing\ndescription: Extract PDF text, fill forms, merge files. Use when handling PDFs.\nlicense: Apache-2.0\nmetadata:\n  author: example-org\n  version: "1.0"\nallowed-tools: Bash(git:*) Read'),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.skill.name).toBe('pdf-processing');
    expect(r.skill.license).toBe('Apache-2.0');
    expect(r.skill.metadata).toEqual({ author: 'example-org', version: '1.0' });
    expect(r.skill.allowedTools).toBe('Bash(git:*) Read');
    expect(r.skill.body).toBe('# Steps\n\nDo the thing.');
  });

  it('reads quoted, folded, literal and continued values, comments, CRLF and a byte-order mark', () => {
    const folded = parseSkillMd(md('name: maize-planting\n# a comment\ndescription: >\n  Plant maize at the right time.\n  Use when the rains are late.'));
    expect(folded.ok && folded.skill.description).toBe('Plant maize at the right time. Use when the rains are late.');
    const literal = parseSkillMd(md("name: a1\ndescription: |\n  Line one.\n  Line two."));
    expect(literal.ok && literal.skill.description).toBe('Line one.\nLine two.');
    const continued = parseSkillMd(md('name: a1\ndescription: Plant maize\n  when the rains are late.'));
    expect(continued.ok && continued.skill.description).toBe('Plant maize when the rains are late.');
    const single = parseSkillMd(md("name: 'a1'\ndescription: 'It''s for: planting'"));
    expect(single.ok && single.skill.description).toBe("It's for: planting");
    const crlf = parseSkillMd('﻿---\r\nname: a1\r\ndescription: "Says \\"hi\\": once"\r\n---\r\nBody\r\n');
    expect(crlf.ok && crlf.skill).toEqual({ name: 'a1', description: 'Says "hi": once', body: 'Body' });
  });

  it('accepts a name at exactly 64 characters and a description at exactly 1024', () => {
    expect(codes(md(`name: ${'a'.repeat(NAME_MAX)}\ndescription: ${'d'.repeat(DESCRIPTION_MAX)}`))).toEqual([]);
  });

  it('follows the reference validator on names: NFKC first, and lowercase Unicode letters are letters', () => {
    expect(codes(md('name: ｐｄｆ-tools\ndescription: x'))).toEqual([]); // full-width letters normalise to "pdf"
    expect(parseSkillMd(md('name: ｐｄｆ-tools\ndescription: x'))).toMatchObject({ ok: true, skill: { name: 'pdf-tools' } });
    expect(codes(md('name: kurima-chibage\ndescription: x'))).toEqual([]);
    expect(codes(md('name: café\ndescription: x'))).toEqual([]);
  });

  it('writes a SKILL.md that reads back to the same fields', () => {
    const f: SkillFields = {
      name: 'rain-advice',
      description: 'Say when to plant: "early" or "late". Use when asked about rain.',
      body: '# Rain\n\n- Check the forecast\n- Plant after 25 mm',
      license: 'Apache-2.0',
      compatibility: 'Works offline',
      metadata: { author: 'Tendai', 'odd key': 'a: b' },
      allowedTools: 'Read',
    };
    const text = writeSkillMd(f);
    expect(text.startsWith('---\nname: rain-advice\n')).toBe(true);
    expect(parseSkillMd(text)).toEqual({ ok: true, skill: f });
    expect(parseSkillMd(writeSkillMd({ name: 'a', description: 'b', body: '' }))).toEqual({ ok: true, skill: { name: 'a', description: 'b', body: '' } });
  });
});

describe('a bad name', () => {
  it('refuses the spec\'s invalid examples', () => {
    expect(codes(md('name: PDF-Processing\ndescription: x'))).toEqual(['name:name_case']);
    expect(codes(md('name: -pdf\ndescription: x'))).toEqual(['name:name_hyphen_end']);
    expect(codes(md('name: pdf-\ndescription: x'))).toEqual(['name:name_hyphen_end']);
    expect(codes(md('name: pdf--processing\ndescription: x'))).toEqual(['name:name_double_hyphen']);
  });

  it('refuses anything but letters, digits and hyphens', () => {
    for (const n of ['pdf_processing', 'pdf.processing', '"pdf processing"', 'pdf/x']) {
      expect(codes(md(`name: ${n}\ndescription: x`)), n).toContain('name:name_chars');
    }
    expect(codes(md('name: Café\ndescription: x'))).toContain('name:name_case');
  });

  it('validateSkill says the same live, field by field, for the builder', () => {
    expect(validateSkill({ name: 'Bad Name', description: 'ok', body: '' }).map((p) => p.code)).toEqual(['name_case', 'name_chars']);
    expect(validateSkill({ name: 'good', description: 'ok', body: '' })).toEqual([]);
  });
});

describe('missing fields', () => {
  it('needs a name and a description', () => {
    expect(codes(md('description: x'))).toEqual(['name:missing']);
    expect(codes(md('name: a1'))).toEqual(['description:missing']);
    expect(codes(md('name: a1\ndescription:'))).toEqual(['description:missing']);
    expect(codes(md('name: a1\ndescription: "   "'))).toEqual(['description:missing']);
    expect(codes(md('name: ""\ndescription: x'))).toEqual(['name:missing']);
  });

  it('needs the frontmatter itself, closed', () => {
    expect(codes('# Just markdown\n')).toEqual(['file:no_frontmatter']);
    expect(codes('---\nname: a1\ndescription: x\n')).toEqual(['file:unclosed']);
  });

  it('keeps what it could read, so the builder can show it for fixing', () => {
    const r = parseSkillMd(md('name: Bad\ndescription: Fine'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.partial).toMatchObject({ name: 'Bad', description: 'Fine', body: '# Steps\n\nDo the thing.' });
  });
});

describe('overlong fields', () => {
  it('refuses a 65-character name, a 1025-character description and a 501-character compatibility', () => {
    expect(parseSkillMd(md(`name: ${'a'.repeat(NAME_MAX + 1)}\ndescription: x`))).toMatchObject({
      ok: false,
      problems: [{ field: 'name', code: 'too_long', max: 64, length: 65 }],
    });
    expect(codes(md(`name: a1\ndescription: ${'d'.repeat(DESCRIPTION_MAX + 1)}`))).toEqual(['description:too_long']);
    expect(codes(md(`name: a1\ndescription: x\ncompatibility: ${'c'.repeat(COMPATIBILITY_MAX + 1)}`))).toEqual(['compatibility:too_long']);
    expect(codes(md('name: a1\ndescription: x\ncompatibility: ""'))).toEqual(['compatibility:missing']);
  });

  it('counts characters, as the reference validator does: 64 accented letters still fit', () => {
    expect(codes(md(`name: ${'é'.repeat(NAME_MAX)}\ndescription: x`))).toEqual([]);
  });

  it('holds the instructions to Shamwari\'s own limit (not the spec\'s)', () => {
    expect(codes(md('name: a1\ndescription: x', 'b'.repeat(BODY_MAX)))).toEqual([]);
    expect(codes(md('name: a1\ndescription: x', 'b'.repeat(BODY_MAX + 1)))).toEqual(['body:too_long']);
  });
});

describe('what the spec does not allow, or this reader does not read', () => {
  it('refuses a field the spec does not define', () => {
    expect(codes(md('name: a1\ndescription: x\nversion: 2'))).toEqual(['file:unknown_field']);
  });

  it('refuses YAML it cannot read, with the line, rather than guessing', () => {
    const r = parseSkillMd('---\nname: a1\ndescription: Use when: planting\n---\n');
    expect(r).toMatchObject({ ok: false, problems: [{ field: 'file', code: 'bad_yaml', line: 3 }] });
    expect(codes(md('name: a1\nname: a2\ndescription: x'))).toEqual(['file:bad_yaml']); // duplicate key
    expect(codes(md('name: [a, b]\ndescription: x'))).toEqual(['file:bad_yaml']); // flow sequence
    expect(codes(md('name: "a1\ndescription: x'))).toEqual(['file:bad_yaml']); // unclosed quote
    expect(codes(md('  name: a1\ndescription: x'))).toEqual(['file:bad_yaml']); // indented key
  });

  it('refuses metadata that is not a map', () => {
    expect(codes(md('name: a1\ndescription: x\nmetadata: author'))).toEqual(['metadata:not_map']);
  });
});
