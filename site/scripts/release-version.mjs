// The release name people see in Settings ("v0.4.0"), worked out at build time.
//
// Releases are cut on main by the organisation's release app: it tags the merged commit vX.Y.Z seconds after the push, and
// not every merge gets one. The Cloudflare Workers Build clones without tags and starts at that same push, so neither the
// clone nor `git describe` can be trusted to know the number. This asks the repository itself (`git ls-remote`, which needs
// no history and no tags in the clone):
//   - this commit carries a release tag      -> "v0.4.0"   (the build IS that release)
//   - it does not (yet)                      -> "v0.4.0+"  (newer than the latest release; the tag may land a moment later)
//   - nothing can be found (offline, no git) -> null       (the label shows only the build fingerprint, never a made-up number)
// APP_VERSION (vX.Y.Z) overrides all of it, for a deploy that knows better.

const SEMVER = /^v(\d+)\.(\d+)\.(\d+)$/;

/** Highest of a list of vX.Y.Z tags, or null. */
export function highest(tags) {
  let best = null;
  for (const t of tags) {
    const m = SEMVER.exec(t);
    if (!m) continue;
    const v = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!best || v[0] > best.v[0] || (v[0] === best.v[0] && (v[1] > best.v[1] || (v[1] === best.v[1] && v[2] > best.v[2])))) best = { t, v };
  }
  return best?.t ?? null;
}

/** Tags and the commits they name, from `git ls-remote --tags` output (annotated tags list their commit on a `^{}` line). */
export function parseLsRemote(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const [sha, ref] = line.trim().split(/\s+/);
    if (!sha || !ref?.startsWith('refs/tags/')) continue;
    out.push({ sha, tag: ref.slice('refs/tags/'.length).replace(/\^\{\}$/, '') });
  }
  return out;
}

/**
 * @param {{ env?: Record<string, string | undefined>, git: (args: string[]) => string }} deps
 *   `git` runs git and returns stdout, throwing on failure or timeout.
 * @returns {string | null}
 */
export function releaseVersion({ env = {}, git }) {
  const given = env.APP_VERSION?.trim();
  if (given && SEMVER.test(given)) return given;

  let head = null;
  try {
    head = git(['rev-parse', 'HEAD']).trim();
  } catch {
    /* not a git checkout */
  }

  // A full clone with tags answers locally, without the network.
  try {
    const here = highest(git(['tag', '--points-at', 'HEAD']).split('\n').map((s) => s.trim()));
    if (here) return here;
    const before = git(['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*.[0-9]*.[0-9]*']).trim();
    if (SEMVER.test(before)) return `${before}+`;
  } catch {
    /* no tags in this clone: the usual case in the Workers Build */
  }

  try {
    const tags = parseLsRemote(git(['ls-remote', '--tags', 'origin', 'v*'])).filter((r) => SEMVER.test(r.tag));
    if (head) {
      const here = highest(tags.filter((r) => r.sha === head).map((r) => r.tag));
      if (here) return here;
    }
    const latest = highest(tags.map((r) => r.tag));
    if (latest) return `${latest}+`;
  } catch {
    /* offline, or no remote */
  }
  return null;
}
