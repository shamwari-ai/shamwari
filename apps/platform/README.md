# @shamwari/platform

Developer and business portal at **platform.shamwari.ai** — part of the [Shamwari AI](../../README.md) monorepo.

## Overview

The platform app is where developers and businesses manage their Shamwari AI integration. It provides API key management, usage dashboards, billing, documentation, and onboarding for programmatic access to Shamwari's AI capabilities.

## Tech Stack

- **Next.js 16** (App Router) with Turbopack
- **Tailwind CSS v4** with Stone theme
- **shadcn/ui** components from `@shamwari/ui`
- **Stytch** for authentication (Mukoko B2C)
- **Vercel Serverless** for Route Handlers and Server Actions (direct MongoDB access)
- **Cloudflare R2** for file uploads via server actions

## Development

From the monorepo root:

```bash
npm run dev:platform   # Start on port 3001
```

Or from this directory:

```bash
npm run dev            # next dev --turbopack --port 3001
npm run build          # next build
npm run lint           # eslint
npm run check-types    # tsc --noEmit
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
| `R2_ACCOUNT_ID` | Cloudflare R2 account ID |
| `R2_ACCESS_KEY_ID` | R2 access key |
| `R2_SECRET_ACCESS_KEY` | R2 secret access key |
| `R2_BUCKET_NAME` | R2 bucket name (default: `shamwari-assets`) |

## Deployment

Deploys to **Vercel** as the `shamwari-platform` project. See `vercel.json` for workspace-aware build configuration.

## Structure

```
apps/platform/
├── app/               # Next.js App Router (pages, layouts, routes)
├── lib/               # App-specific utilities
├── public/            # Static assets
├── components.json    # shadcn/ui configuration
├── vercel.json        # Vercel deployment config
└── .env.example       # Environment variable template
```
