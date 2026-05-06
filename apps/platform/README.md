# @shamwari/platform

Developer and business portal at **platform.shamwari.ai** — part of the [Shamwari AI](../../README.md) monorepo.

## Overview

The platform app is where developers and businesses manage their Shamwari AI integration. It provides API key management, usage dashboards, billing, documentation, and onboarding for programmatic access to Shamwari's AI capabilities.

## Tech Stack

- **SvelteKit 2** + **Svelte 5** (runes mode)
- **Tailwind CSS v4** with Stone theme
- Shared design tokens and JSON-LD helpers from `@shamwari/ui`
- **Stytch** for authentication (Mukoko B2C)
- **Vercel** with `@sveltejs/adapter-vercel` (serverless functions for SSR + endpoints)
- **Cloudflare R2** for file uploads via server endpoints

## Development

From the monorepo root:

```bash
npm run dev:platform   # Start on port 3001
```

Or from this directory:

```bash
npm run dev            # vite dev --port 3001
npm run build          # vite build (SvelteKit)
npm run preview        # vite preview
npm run lint           # eslint
npm run check          # svelte-check
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
| `R2_ACCOUNT_ID` | Cloudflare R2 account ID |
| `R2_ACCESS_KEY_ID` | R2 access key |
| `R2_SECRET_ACCESS_KEY` | R2 secret access key |
| `R2_BUCKET_NAME` | R2 bucket name (default: `shamwari-assets`) |

SvelteKit reads private vars via `$env/dynamic/private`; only `PUBLIC_*` prefixed vars are exposed to the browser.

## Deployment

Deploys to **Vercel** as the `shamwari-platform` project. See `vercel.json` for workspace-aware build configuration.

## Structure

```
apps/platform/
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
