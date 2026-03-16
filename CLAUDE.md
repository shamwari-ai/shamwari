# CLAUDE.md — Shamwari AI

## Project Overview

**Shamwari AI** is Nyuchi Africa's open source initiative to build a localized AI model and platform purpose-built for the African continent. The name "shamwari" means "friend" in Shona.

- **Founder & CEO**: Bryan Fawcett
- **Organization**: Nyuchi Africa (Zimbabwean tech company building open source, community-based platforms)
- **Development Division**: Nyuchi Web Services
- **Ecosystem**: Mukoko (Nyuchi's super app ecosystem)
- **License**: MIT
- **Repository**: `nyuchitech/shamwari-ai`

### Two Core Pillars

1. **The Model** — A small, efficient language model (1B–7B parameters) designed for on-device inference across affordable hardware. Deep multilingual support for African languages starting with Shona and Ndebele, expanding across Southern and broader Africa. Quantizable for affordable Android devices, also served via API for higher-quality cloud inference.

2. **The Platform** — A full-stack AI platform with two web properties:
   - **shamwari.ai** — Consumer-facing AI chat application (similar to ChatGPT's interface, built in-house)
   - **platform.shamwari.ai** — Developer and business portal providing API key management, usage dashboards, billing, documentation, and onboarding for programmatic access to Shamwari's AI capabilities

Shamwari is not trying to be GPT. It's the AI that actually works for Africa: small enough to run locally, smart enough to be useful, culturally grounded, and commercially sustainable through API access and platform services.

## Technical Stack & Architecture

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Frontend | Next.js 16 (App Router) | Both web properties — shamwari.ai and platform.shamwari.ai |
| UI | shadcn/ui + Tailwind CSS v4 | Component library — Stone theme, Noto Sans, Lucide icons, large radius |
| Monorepo | Turborepo + npm workspaces | Build orchestration across apps and packages |
| Edge | Cloudflare Workers | API gateway, rate limiting, API key validation, cron jobs, caching |
| AI Backend | Python (FastAPI) on Fly.io | AI inference, model management, API endpoints — direct CouchDB access |
| Inference | Rust | Model loading (GGUF/ONNX), token generation, quantized inference |
| Database | CouchDB (on Fly.io) | Operational data — per-user databases for local-first PouchDB sync |
| Analytics | Apache Doris (on Fly.io) | OLAP engine for usage metrics, billing aggregation, dashboards |
| Storage | Cloudflare R2 | Model artifacts, file uploads, static assets |
| Model | Custom (1B–7B) | On-device + cloud inference, African language focus |
| Frontend Hosting | Vercel | Two projects — `shamwari-web` and `shamwari-platform` |
| AI Hosting | Fly.io | Python FastAPI backend, CouchDB, Doris, event workers |
| Structured Data | Schema.org (JSON-LD) | Frontend pages and API responses use Schema.org types |
| API Spec | OpenAPI 3.1 | Full API contract auto-generated from FastAPI, committed as openapi.json |

### Architecture Principles

- **Turborepo monorepo** with npm workspaces — `apps/*` for deployable apps, `packages/*` for shared code
- **Local-first architecture**: CouchDB (server) + PouchDB (client) for offline-capable bidirectional sync
- **Per-user CouchDB databases**: Each user gets `shamwari_user_{id}` — PouchDB syncs directly with no filtering needed
- **Fly.io** runs all stateful services — CouchDB, Apache Doris, FastAPI backend, inference API, event workers
- **Vercel** for frontend hosting only — SSR/SSG/CDN. No database access from Vercel
- **Cloudflare Workers** for edge concerns only — API gateway, rate limiting, API key validation, caching, cron triggers
- **CouchDB** as the sole operational data layer — do not use MongoDB, SQL, D1, or other databases for operational data
- **Apache Doris** for analytics only — fed by CouchDB _changes feed via event pipeline worker
- **R2** for all object/blob storage needs — model weights, uploads, assets
- **Schema.org compliance** — Frontend pages use JSON-LD structured data, API responses include @context/@type fields
- **OpenAPI 3.1 compliance** — Full API contract defined in FastAPI, auto-generated openapi.json committed to repo
- **Fully open source** — every component from model weights to platform code designed for open distribution and community contribution

## Repository Structure

```
shamwari-ai/
├── apps/
│   ├── web/               # shamwari.ai — consumer chat (Next.js, @shamwari/web)
│   │   ├── app/           # App Router pages and layouts
│   │   ├── components/    # App-specific React components
│   │   ├── lib/           # App-specific utilities
│   │   ├── components.json # shadcn/ui config for this app
│   │   └── vercel.json    # Vercel deployment config (shamwari-web project)
│   └── platform/          # platform.shamwari.ai — developer portal (Next.js, @shamwari/platform)
│       ├── app/           # App Router pages and layouts
│       ├── components/    # App-specific React components
│       ├── lib/           # App-specific utilities
│       ├── components.json # shadcn/ui config for this app
│       └── vercel.json    # Vercel deployment config (shamwari-platform project)
├── packages/
│   └── ui/                # Shared component library (@shamwari/ui)
│       ├── src/
│       │   ├── components/ # Shared shadcn/ui components
│       │   ├── hooks/     # Shared React hooks
│       │   ├── lib/       # Shared utilities (cn, etc.)
│       │   └── styles/    # Shared theme CSS (Stone theme tokens)
│       └── components.json # shadcn/ui config for shared components
├── src/                   # Python backend (FastAPI + CouchDB) — deploys to Fly.io
│   ├── auth/              # Stytch authentication integration
│   ├── db/                # CouchDB initialization, document helpers, design documents
│   ├── models/            # CouchDB document models (Pydantic, 13 document types)
│   ├── schemas/           # API request/response schemas (Schema.org-aligned)
│   └── routers/           # FastAPI API routers (OpenAPI-annotated, /v1 prefix)
├── tasks/
│   ├── todo.md            # Current task tracking with checkable items
│   └── lessons.md         # Accumulated lessons and patterns from corrections
├── .dockerignore          # Docker build exclusions
├── .env.example           # Root env template (Python backend vars)
├── package.json           # Root npm workspace config (Turborepo)
├── turbo.json             # Turborepo pipeline configuration
├── pyproject.toml         # Python project configuration
├── fly.toml               # Fly.io deployment config (Johannesburg region)
├── Dockerfile             # Docker image for Fly.io deployment
├── CLAUDE.md              # This file — guidance for AI assistants
├── LICENSE                # MIT License
└── README.md              # Project description
```

### Workspace Packages

| Package / Service | Path | Description | Deploys to |
|-------------------|------|-------------|------------|
| `@shamwari/web` | `apps/web` | Consumer chat app (shamwari.ai) | Vercel: `shamwari-web` |
| `@shamwari/platform` | `apps/platform` | Developer portal (platform.shamwari.ai) | Vercel: `shamwari-platform` |
| `@shamwari/ui` | `packages/ui` | Shared shadcn/ui component library | (internal package) |
| Python backend | `src/` | FastAPI + CouchDB (AI inference, API, model mgmt) | Fly.io (linked to GitHub repo) |

### Frontend Commands

```bash
npm run dev              # Start all apps (Turbo)
npm run dev:web          # Start shamwari.ai only (port 3000)
npm run dev:platform     # Start platform.shamwari.ai only (port 3001)
npm run build            # Build all apps
npm run lint             # Lint all apps
npm run check-types      # Type-check all apps
```

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.
- **Open Source Philosophy**: Every component should be designed for open distribution and community contribution.
- **Africa-First Design**: Prioritize African languages, cultural context, resource constraints, and practical utility.

## Workflow Orchestration

### 1. Plan Mode Default

- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately — don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy

- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop

- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done

- Never mark a task complete without proving it works
- Diff behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)

- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes — don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing

- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Task Management

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

## Development Guidelines

### Branch Strategy

- **`main`** is the primary branch. All work merges into `main`.
- Feature branches should use descriptive names (e.g., `feature/model-training-pipeline`, `fix/tokenizer-encoding`).
- Create pull requests for all changes — do not push directly to `main`.

### Commit Messages

- Use clear, imperative-mood commit messages (e.g., "Add tokenizer for Shona language", not "Added tokenizer").
- Keep the subject line under 72 characters.
- Add a body for non-trivial changes explaining **why**, not just **what**.

### Code Style

- Prioritize readability and maintainability over cleverness.
- Use consistent naming conventions appropriate to the language being used.
- Add comments only where the logic is non-obvious — let code be self-documenting where possible.
- Avoid over-engineering: build for current requirements, not hypothetical future ones.

### File Organization

- Place Python backend code in `src/`.
- Place frontend app code in `apps/web/` or `apps/platform/` as appropriate.
- Place shared frontend components, hooks, and utilities in `packages/ui/`.
- Place tests in `tests/`, mirroring the source structure.
- Place root configuration files (turbo.json, pyproject.toml, etc.) at the project root.
- Place extended documentation in `docs/`.
- Keep the root directory clean.

### Testing

- Write tests for all new functionality.
- Place Python tests in `tests/`, mirroring the `src/` structure. Create the directory when adding the first test.
- Tests should be runnable with a single command: `pytest` (Python) or via Turbo scripts (frontend).
- Prefer integration tests for critical paths and unit tests for isolated logic.

### Dependencies

- Pin dependency versions explicitly for reproducibility.
- Evaluate new dependencies carefully — prefer well-maintained, widely-used libraries.
- Document any system-level dependencies or prerequisites in the README.

## AI Model Guidelines

- Favor small parameter counts (1B–7B range) that can be quantized for on-device inference on affordable Android devices
- Cloud inference via API for higher-quality results when device constraints don't apply
- Prioritize African language support: Shona and Ndebele first, then expand across Southern and broader Africa
- Culturally appropriate responses grounded in African contexts
- Practical utility for: education, commerce, agriculture, health, and daily communication
- Model weights and training code should be fully open source

## Platform & Business Context

Shamwari is a product with a developer ecosystem. When working on platform features, keep in mind:

- **API pricing tiers** — design for affordability while maintaining commercial sustainability
- **Developer documentation** — clear, thorough, accessible to developers of varying experience
- **Onboarding flows** — smooth path from signup to first API call
- **Value proposition** for African businesses: language coverage, cultural context, data sovereignty, affordability, latency advantages from regional deployment
- **Usage tracking and billing** — stored in CouchDB, aggregated via Doris, surfaced through platform.shamwari.ai dashboards

## AI Assistant Operating Rules

### Before Starting Work

1. Read existing files before modifying them. Understand the context.
2. Check `tasks/lessons.md` for relevant patterns and past corrections.
3. For non-trivial tasks, enter plan mode and write to `tasks/todo.md`.

### While Working

1. Make only the changes necessary to accomplish the task.
2. Respect existing patterns — follow established conventions even if you'd do it differently.
3. No speculative code — don't add features, error handling, or abstractions beyond what is requested.
4. Never commit secrets, API keys, or credentials.
5. Run tests after making changes if a test framework is configured.
6. Use CouchDB for all operational data persistence — never introduce MongoDB, SQL, or D1.
7. Use per-user CouchDB databases for user-scoped data (conversations, preferences) — enables PouchDB sync.
8. Use Cloudflare Workers for edge concerns only (API gateway, rate limiting, caching, cron).
9. Use Fly.io for Python FastAPI backend, CouchDB, Doris, and all stateful services.
10. Ensure API responses include Schema.org @context/@type for entity endpoints.
11. Keep openapi.json in sync — regenerate via `python scripts/export_openapi.py` after API changes.

### After Finishing

1. Prove your work is correct — run tests, check logs, demonstrate behavior.
2. Update `tasks/todo.md` with completed items and review notes.
3. If you received a correction, update `tasks/lessons.md` with the lesson.

### What to Avoid

- Do not add documentation files unless explicitly asked.
- Do not create CI/CD pipelines or deployment configurations without instruction.
- Do not introduce heavy frameworks or dependencies without discussion.
- Do not restructure the repository layout without explicit approval.
- Do not use MongoDB, SQL, D1, or any relational database — CouchDB only for operational data, Doris for analytics.
- Do not propose solutions that ignore African resource constraints (bandwidth, compute, device capabilities).
