// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { highest, parseLsRemote, releaseVersion } from '../../scripts/release-version.mjs';

const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const LS = [`${OLD}\trefs/tags/v0.3.2`, `${HEAD}\trefs/tags/v0.4.0`, `${'c'.repeat(40)}\trefs/tags/v0.10.0-rc1`, `${'d'.repeat(40)}\trefs/tags/v0.2.6`].join('\n');

/** A git that answers like the Workers Build clone: a commit, no tags of its own, and a remote that has them. */
const git = (over: Record<string, string | Error> = {}) => (args: string[]) => {
  const key = args.slice(0, 2).join(' ');
  const answers: Record<string, string | Error> = {
    'rev-parse HEAD': `${HEAD}\n`,
    'tag --points-at': '',
    'describe --tags': new Error('fatal: No names found'),
    'ls-remote --tags': LS,
    ...over,
  };
  const a = answers[key];
  if (a === undefined) throw new Error(`unexpected git ${args.join(' ')}`);
  if (a instanceof Error) throw a;
  return a;
};

describe('the version people see is the real release, even from a clone with no tags', () => {
  it('a build of the released commit reads as that release', () => {
    expect(releaseVersion({ git: git() })).toBe('v0.4.0');
  });

  it('a build newer than the last release reads as that release with a +, not an older or invented number', () => {
    expect(releaseVersion({ git: git({ 'rev-parse HEAD': `${'e'.repeat(40)}\n` }) })).toBe('v0.4.0+');
  });

  it('annotated tags are matched by the commit they point at', () => {
    const annotated = `${'f'.repeat(40)}\trefs/tags/v0.5.0\n${HEAD}\trefs/tags/v0.5.0^{}`;
    expect(releaseVersion({ git: git({ 'ls-remote --tags': annotated }) })).toBe('v0.5.0');
  });

  it('never falls back to a made-up number: with no git and no network it gives nothing, and the label is the fingerprint alone', () => {
    const none = () => {
      throw new Error('git: not found');
    };
    expect(releaseVersion({ git: none })).toBeNull();
  });

  it('a full clone answers locally first: a tag on this commit, else the last tag before it with a +', () => {
    expect(releaseVersion({ git: git({ 'tag --points-at': 'v0.4.0\nv0.3.9\n', 'ls-remote --tags': new Error('offline') }) })).toBe('v0.4.0');
    expect(releaseVersion({ git: git({ 'describe --tags': 'v0.3.2\n', 'ls-remote --tags': new Error('offline') }) })).toBe('v0.3.2+');
  });

  it('APP_VERSION wins when it is a release name, and is ignored when it is not', () => {
    expect(releaseVersion({ env: { APP_VERSION: 'v2.0.0' }, git: git() })).toBe('v2.0.0');
    expect(releaseVersion({ env: { APP_VERSION: 'latest' }, git: git() })).toBe('v0.4.0');
  });
});

describe('helpers', () => {
  it('compares versions as numbers, not text, and skips non-release tags', () => {
    expect(highest(['v0.9.0', 'v0.10.0', 'v0.10.0-rc1', 'nightly'])).toBe('v0.10.0');
    expect(highest([])).toBeNull();
  });

  it('reads ls-remote output', () => {
    expect(parseLsRemote(LS).map((r) => r.tag)).toEqual(['v0.3.2', 'v0.4.0', 'v0.10.0-rc1', 'v0.2.6']);
  });
});
