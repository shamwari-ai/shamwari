# Lessons Learned — Shamwari AI

## Session: 2026-03-01 — Data Model Architecture

### Architecture Decisions
- **Auth**: Stytch (Mukoko B2C identity) — not MongoDB App Services auth
- **MongoDB App Services**: Data API + Triggers + Functions (no built-in auth)
- **Backend**: Python (FastAPI) + Cloudflare Workers (edge) + Rust (inference)
- **Frontend**: Next.js for both shamwari.ai and platform.shamwari.ai
- **ODM**: Beanie (async, Pydantic-based) over MongoEngine (sync, older)

### Patterns
- Store `stytch_user_id` on user documents — never store passwords
- Hash API keys with SHA-256, store only the hash + a prefix for display
- Embed small, bounded data (settings, members). Reference unbounded data (messages)
- Use MongoDB time-series collection pattern for usage_records
- TTL indexes for automatic cleanup of high-volume collections

## Session: 2026-03-01 — Turborepo Monorepo + Frontend Setup

### Architecture Decisions
- **Monorepo**: Turborepo + npm workspaces (not pnpm — `workspace:*` protocol not supported by npm)
- **Workspace layout**: `apps/*` for deployable apps, `packages/*` for shared libraries
- **Package naming**: `@shamwari/web`, `@shamwari/platform`, `@shamwari/ui` (branded namespace)
- **Deployment**: Each app deploys as a separate Vercel project (`shamwari-web`, `shamwari-platform`)
- **UI**: shadcn/ui with Stone theme, Noto Sans, Lucide icons, large radius, dark mode via `next-themes`
- **CSS**: Tailwind v4 with oklch color tokens, `@custom-variant dark`, `@source` for cross-package scanning

### Patterns
- **shadcn registry blocked**: If `ui.shadcn.com` is unreachable, manually create `components.json`, `lib/utils.ts`, and theme CSS — the CLI is convenience, not a requirement
- **Tailwind v4 monorepo scanning**: Each app's `globals.css` needs `@source "../../../packages/ui/src/**/*.{ts,tsx}"` to detect classes from shared packages
- **Font fallback**: `next/font/google` fails at build time without network access to Google Fonts — builds succeed in production (Vercel) where network is available
- **Turbo requires `packageManager`**: Root `package.json` must include `"packageManager": "npm@10.9.4"` or Turbo refuses to resolve workspaces
- **Port separation**: `apps/web` on 3000 (default), `apps/platform` on 3001 (`--port 3001`)
- **Per-app `vercel.json`**: Use `installCommand: "npm install --prefix=../.."` and `buildCommand: "cd ../.. && npx turbo build --filter=@shamwari/web"` for workspace-aware Vercel builds
- **Clean up nested `.git`**: `create-next-app` runs `git init` inside each scaffolded app — remove these in a monorepo
