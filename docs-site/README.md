# docs.shamwari.ai — content migrated, do not edit the pages

**The 7 pages under `src/content/docs/` have moved to `shamwari-ai/docs`
(Mintlify) as real MDX content.** See shamwari-ai/docs#1 for the migration
and shamwari-ai/shamwari#23 for the issue that tracks it. Edit the pages
there — `index`, `rules`, `scopes`, `architecture`, `routing`, `ground`,
`language`, `traffic` — not the copies in this directory.

This Astro site is still what `docs.shamwari.ai` serves today. Nothing here
has been deleted and no DNS/Workers routing change has been made — #23 leaves
both as open human decisions (which source is canonical, and whether to
delete `docs-site/` once it's confirmed). Until that lands, this directory
still builds and deploys as before; treat its content pages as a stale mirror
rather than a place to fix things.

---

Astro with MDX content, static output, served by **Cloudflare Workers static
assets**. Not Vercel — the docs site is Cloudflare, like the gateway.

```bash
npm install
npm run dev              # astro dev
npm run build            # astro build -> dist/
npm run check            # astro check + node check.mjs (run after a build)
npm run deploy           # astro build && wrangler deploy
```

The custom domain has to be attached to the account before the first deploy;
`wrangler.jsonc` declares `docs.shamwari.ai` as a custom-domain route.

## Layout

```
src/content/docs/*.mdx   the pages — one file each, frontmatter sets nav order
src/content.config.ts    the collection schema
src/layouts/Doc.astro    shell, nav, and all prose styling
src/components/          Rule, Verdict, Note, ScopeFlow — used from MDX
src/styles/tokens.css    the sodalite palette, defined once
```

Adding a page means adding one `.mdx` file with a `title`, `summary` and
`order`. The nav is built from the collection, so there is no list anywhere to
forget to update.

## Why static, and why no client JavaScript

The site's own argument is that Shamwari is designed for a slow connection
and a small screen. A docs site that shipped a framework runtime to make that
argument would be refuting itself. So: `output: 'static'`, no islands, no
hydration. The largest page is about 8KB of HTML.

Static output also means this repo holds no bindings and no secrets, which is
the point of splitting it out — anyone in the org can fix a typo here without
touching a repo that can deploy inference.

## check.mjs

`astro check` covers types and MDX. `check.mjs` runs against `dist/` and
covers what it cannot:

- internal links resolve to a route that was actually built, and asset paths
  resolve to a file that exists
- every CSS custom property has a base `:root` value, so no colour is defined
  only inside a `prefers-color-scheme` or `[data-theme]` block — the bug that
  renders one theme's text on the other theme's background
- no page ships a `<script>` tag
- the largest page stays under 50KB
- no page says "open source" outside the passage that explains why not. That
  is a project rule from CLAUDE.md, this is a public site, and it is the
  exact slip a docs page invites — so it is enforced mechanically rather than
  from memory

All four have been exercised against deliberate regressions.

## Content

Written for someone deciding whether to trust Shamwari, not for someone about
to contribute — the repo's own `README.md` and `CLAUDE.md` serve that reader.

Everything asserted here is true of the code as committed. If a claim on
these pages stops matching the implementation, the page is the bug.
