import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STATUS } from '../../src/data/status';

// Shamwari Chat may only be called "Live" once it answers real questions with
// citations. Until then the site says "Building". Flipping it takes a written
// record of that check in docs/chat-live-evidence.md (who ran it, against
// which deployment, the question asked and the citation returned). The file
// does not exist yet; creating it is a deliberate act the owner reviews.
const EVIDENCE = new URL('../../../docs/chat-live-evidence.md', import.meta.url);

describe('Shamwari Chat status', () => {
  const chat = STATUS.find((s) => s.title === 'Shamwari Chat');

  it('is listed', () => {
    expect(chat).toBeDefined();
  });

  it('is not Live without recorded evidence of a real cited answer', () => {
    if (chat!.state !== 'live') return;
    expect(existsSync(EVIDENCE), 'docs/chat-live-evidence.md is required before Chat can be Live').toBe(true);
    const text = readFileSync(EVIDENCE, 'utf8');
    expect(text).toMatch(/deployment:\s*https:\/\//i);
    expect(text).toMatch(/question:/i);
    expect(text).toMatch(/citation:/i);
  });

  it('does not claim to answer real questions while Building', () => {
    if (chat!.state === 'live') return;
    expect(chat!.body).not.toMatch(/\b(now|today)\b.*\banswers?\b/i);
    expect(chat!.body).toMatch(/does not answer real questions yet|not built yet/i);
  });
});
