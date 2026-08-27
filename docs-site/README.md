# docs.shamwari.ai

One HTML file and two typefaces. No build step, no JavaScript, no bindings,
no secrets — deliberately, so that anyone in the org can fix a typo here
without touching a repo that can deploy inference.

```bash
npm install
npm run check     # anchors, theme tokens, size budget, language rule
npm run dev
npm run deploy    # needs the custom domain attached to the account first
```

## Why it is built this way

The site argues that Shamwari is designed for a slow connection and a small
screen. A docs site that shipped a framework to make that argument would be
refuting itself. So: one request, ~24KB, and the only network dependency is
Google Fonts.

`npm run check` is the whole test suite, and it exists because there is no
compiler to catch anything:

- every in-page link resolves to an id that exists
- every CSS custom property has a base `:root` value, so no colour is
  defined only inside a `prefers-color-scheme` or `[data-theme]` block —
  that bug renders one theme's text on the other theme's background
- the page stays under 40KB
- the page does not say "open source" outside the passage that explains why
  not to. That is a project rule from CLAUDE.md, and this is a public page,
  so it is worth enforcing mechanically rather than by memory

## Content

The page covers the two rules, the three data scopes, the two services,
tier routing and provenance, Ground and citation, and the language
discipline. It is written for someone deciding whether to trust Shamwari,
not for someone about to contribute to it — the repo's own README and
CLAUDE.md serve that reader.

Everything asserted here is true of the code as committed. If a claim on
this page stops matching the implementation, the page is the bug.
