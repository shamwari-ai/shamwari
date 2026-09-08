# shamwari.ai

The public marketing site. Astro, static output, served by Cloudflare Workers
static assets — the same hosting shape as `docs-site/`, built independently of
it so a copy edit here never touches a repo that can deploy inference. Built
on `@bundu/ui`, Nyuchi's shared marketing component library for the Bundu
Ecosystem, with Shamwari's own sodalite brand overlay on top.

```bash
npm install
npm run dev              # astro dev
npm run build             # astro build -> dist/
npm run check             # astro check + node check.mjs (run after a build)
npm run deploy             # astro build && wrangler deploy
```

The custom domains have to be attached to the account before the first
deploy; `wrangler.jsonc` declares `shamwari.ai` and `www.shamwari.ai` as
custom-domain routes.

## Pages

```
/            overview — hero, the wedge, a taste of the blueprint and status
/blueprint/  how Shamwari is built — Cloud/Ground/Mind, the two rules,
             the sovereignty diagram, the Bundu Ecosystem
/project/    where things actually stand — live/building/planned, and
             the four commercial tiers
/contact/    who should get in touch, and why
```

## Layout

```
src/layouts/Layout.astro        <head>, MineralStrip, Header, Breadcrumb, Footer
src/components/Header.astro     nav — local, @bundu/ui ships no Header/Footer
src/components/Footer.astro     sitemap + ecosystem links + legal line
src/components/StatusPill.astro live / building / planned, on the mineral tokens
src/components/GateDiagram.astro the scope-gate pipeline diagram
src/styles/global.css           @import tailwindcss + @bundu/ui/styles/globals.css
src/styles/brand-shamwari.css   --primary/--ring -> sodalite (see below)
tailwind.config.mjs             @bundu/ui/tailwind-preset, this site's content glob
```

Everything else — `Hero`, `Section`, `SectionHeader`, `Container`,
`MineralStrip`, `Breadcrumb`, `Button`, `Card` — comes straight from
`@bundu/ui`. Pages compose those; they don't hand-roll layout shells.

## The Shamwari brand overlay

`@bundu/ui` ships `brand-{bundu,nyuchi,mukoko}.css` overlays (each just
repoints `--primary`/`--ring` at that brand's mineral) but not one for
Shamwari yet. `src/styles/brand-shamwari.css` is the same one-file pattern,
pointed at `--color-sodalite` — the mineral CLAUDE.md names as Shamwari's.
It's kept here rather than upstream for now; **worth upstreaming to
`@bundu/ui` itself** once someone has push access to `nyuchi/packages-ui`, so
every future Shamwari surface gets it for free instead of re-adding this
file each time.

## Why static, and why no client JavaScript

Same reasoning as `docs-site/`: the audience is assumed to be on a slow
connection, and a page arguing that Shamwari is built for exactly that
connection would be undercutting itself if it shipped a framework runtime to
say so. `@bundu/ui`'s React primitives (`Button`, `Card`, ...) render through
Astro's React integration with **no `client:*` directive anywhere** in this
site — Astro server-renders them to plain HTML and ships zero JS for them.
`check.mjs` verifies no page contains a `<script>` tag other than the
JSON-LD `Breadcrumb` emits. (The build does emit one small, unreferenced
React-runtime chunk under `dist/_astro/` — a side effect of the `@astrojs/react`
integration existing at all — but no page links to it, so no visitor ever
downloads it.)

## check.mjs

Modelled on `docs-site/check.mjs`: internal links resolve to a route that was
actually built, no page ships a `<script>` tag beyond the JSON-LD exception,
every page stays under the 50KB budget, and no page says "open source" or
claims Cloud keeps data "in Africa" — both are language-discipline rules from
the root `CLAUDE.md`, and a marketing page is the one most likely to slip on
them by accident.

## Brand assets

`public/favicon.png`, `public/apple-touch-icon.png`, `public/shamwari-icon.png`
and `public/og/*.png` are all generated, not hand-drawn — see
`scripts/brand-assets/`:

- **The mark itself** — the node-graph icon — is Bundu's own brand mark
  (`scripts/brand-assets/source/bundu-node-mark-{light,dark}.svg`), recoloured
  from Bundu's terracotta to Shamwari's sodalite. The source SVGs are a
  masked raster embed, not flat vector paths, so recolouring can't be a
  `fill` edit: `recolor-mark.mjs` renders the SVG, recovers each pixel's
  coverage by un-mixing it from the known background and original colour,
  then recomposites at any target colour — exact anti-aliasing, not a
  nearest-colour swap. Run `node recolor-mark.mjs <hex> <out-prefix>` to
  reproduce or retarget it (e.g. for a future brand refresh).
- **`public/shamwari-mark-cream.png`** is the same mark recoloured to
  `--canvas`, for use on the dark `og/*.png` backgrounds.
- **`public/og/*.png`** (1200×630, one per page) are built by
  `generate-og-images.mjs` from `og-template.html`: the sodalite background,
  the mark + wordmark together top-left, the page's eyebrow/title/description,
  the page URL bottom-left, and a solid (never faded-to-transparent) honeycomb
  cluster in the seven heritage tones, density-tapered so it thins out toward
  the text rather than stopping at a hard edge — the text rectangle itself is
  a hard exclusion zone, which is what actually keeps it legible. Re-run this
  whenever a page's title/description changes.

Both scripts need `playwright` (`npx playwright install chromium` on a normal
machine; this sandbox pre-installs one at a fixed path, hence the
`PLAYWRIGHT_CHROMIUM_PATH` escape hatch in both scripts) and `sharp` — both
devDependencies.

## Keeping this honest

Every status claim on `/project/` (what's live, what's building, what's
planned) has to match the "Current state" table in the root `CLAUDE.md`. If
that table changes, this page is the thing that's now out of date — not the
other way around.
