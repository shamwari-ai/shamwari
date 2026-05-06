# @shamwari/web

Consumer-facing AI chat application at **shamwari.ai** — part of the [Shamwari AI](../../README.md) monorepo.

## Overview

This is the main chat interface where users interact with Shamwari AI. Think ChatGPT, but purpose-built for Africa — multilingual support for Shona, Ndebele, and other African languages, culturally grounded responses, and designed to work well on affordable devices and low-bandwidth connections.

## Tech Stack

- **SvelteKit 2** + **Svelte 5** (runes mode)
- **Tailwind CSS v4** with Stone theme
- Shared design tokens and JSON-LD helpers from `@shamwari/ui`
- **Stytch** for authentication (Mukoko B2C)
- **Vercel** with `@sveltejs/adapter-vercel` (serverless functions for SSR + endpoints)

## Development

From the monorepo root:

```bash
npm run dev:web      # Start on port 3000
```

Or from this directory:

```bash
npm run dev          # vite dev
npm run build        # vite build (SvelteKit)
npm run preview      # vite preview
npm run lint         # eslint
npm run check        # svelte-check
```

## Environment Variables

Copy `.env.example` to `.env.local` and fill in your values:

| Variable | Description |
|----------|-------------|
| `MONGODB_URI` | MongoDB Atlas connection string (Vercel Serverless access) |
| `PUBLIC_STYTCH_PUBLIC_TOKEN` | Stytch public token (client-side auth) |
| `STYTCH_PROJECT_ID` | Stytch project ID (server-side auth) |
| `STYTCH_SECRET` | Stytch secret key (server-side auth) |
| `AI_API_URL` | Fly.io FastAPI backend URL |

SvelteKit reads private vars via `$env/dynamic/private`; only `PUBLIC_*` prefixed vars are exposed to the browser.

## Deployment

Deploys to **Vercel** as the `shamwari-web` project. See `vercel.json` for workspace-aware build configuration.

## Structure

```
apps/web/
├── src/
│   ├── routes/        # +page.svelte, +layout.svelte, +error.svelte
│   ├── lib/           # App utilities; lib/server/* is server-only
│   ├── app.html       # HTML shell (Intercom widget + fonts)
│   ├── app.css        # Tailwind v4 entry + design tokens
│   └── hooks.server.ts # Security headers
├── public/            # Static assets
├── svelte.config.js
├── vite.config.ts
├── vercel.json        # Vercel deployment config
└── .env.example       # Environment variable template
```
