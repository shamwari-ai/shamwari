# @shamwari/web

Consumer-facing AI chat application at **shamwari.ai** — part of the [Shamwari AI](../../README.md) monorepo.

## Overview

This is the main chat interface where users interact with Shamwari AI. Think ChatGPT, but purpose-built for Africa — multilingual support for Shona, Ndebele, and other African languages, culturally grounded responses, and designed to work well on affordable devices and low-bandwidth connections.

## Tech Stack

- **Next.js 16** (App Router) with Turbopack
- **Tailwind CSS v4** with Stone theme
- **shadcn/ui** components from `@shamwari/ui`
- **Stytch** for authentication (Mukoko B2C)
- **Vercel Serverless** for Route Handlers and Server Actions (direct MongoDB access)

## Development

From the monorepo root:

```bash
npm run dev:web      # Start on port 3000
```

Or from this directory:

```bash
npm run dev          # next dev --turbopack
npm run build        # next build
npm run lint         # eslint
npm run check-types  # tsc --noEmit
```

## Environment Variables

Copy `.env.example` to `.env.local` and fill in your values:

| Variable | Description |
|----------|-------------|
| `MONGODB_URI` | MongoDB Atlas connection string (Vercel Serverless access) |
| `NEXT_PUBLIC_STYTCH_PUBLIC_TOKEN` | Stytch public token (client-side auth) |
| `STYTCH_PROJECT_ID` | Stytch project ID (server-side auth) |
| `STYTCH_SECRET` | Stytch secret key (server-side auth) |
| `AI_API_URL` | Fly.io FastAPI backend URL |

## Deployment

Deploys to **Vercel** as the `shamwari-web` project. See `vercel.json` for workspace-aware build configuration.

## Structure

```
apps/web/
├── app/               # Next.js App Router (pages, layouts, routes)
├── lib/               # App-specific utilities
├── public/            # Static assets
├── components.json    # shadcn/ui configuration
├── vercel.json        # Vercel deployment config
└── .env.example       # Environment variable template
```
