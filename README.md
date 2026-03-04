# Shamwari AI

**Shamwari AI** is [Nyuchi Africa's](https://nyuchi.africa) open source initiative to build a localized AI model and platform purpose-built for the African continent. The name "shamwari" means "friend" in Shona.

Shamwari is not trying to be GPT. It's the AI that actually works for Africa: small enough to run locally, smart enough to be useful, culturally grounded, and commercially sustainable.

## Two Core Pillars

**The Model** — A small, efficient language model (1B–7B parameters) designed for on-device inference across affordable hardware. Deep multilingual support for African languages starting with Shona and Ndebele, expanding across Southern and broader Africa.

**The Platform** — A full-stack AI platform with two web properties:

- **shamwari.ai** — Consumer-facing AI chat application
- **platform.shamwari.ai** — Developer and business portal (API keys, usage dashboards, billing, documentation)

## Tech Stack

| Layer | Technology | Deploys to |
|-------|-----------|------------|
| Frontend | Next.js 16, Tailwind CSS v4, shadcn/ui | Vercel |
| Monorepo | Turborepo + npm workspaces | — |
| Edge | Cloudflare Workers | Cloudflare |
| App Backend | Vercel Serverless (Route Handlers / Server Actions) | Vercel |
| AI Backend | Python (FastAPI) + Beanie ODM | Fly.io |
| Inference | Rust (GGUF/ONNX) | Fly.io |
| Database | MongoDB Atlas | — |
| Auth | Stytch (Mukoko B2C) | — |
| Storage | Cloudflare R2 | Cloudflare |

### Architecture Overview

```
                    ┌─────────────┐
                    │   Clients   │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  Cloudflare │  API gateway, rate limiting,
                    │   Workers   │  API key validation, caching
                    └──────┬──────┘
                     ┌─────┴─────┐
              ┌──────▼──────┐ ┌──▼───────────┐
              │   Vercel    │ │    Fly.io    │
              │ Serverless  │ │   FastAPI    │
              │ (Next.js)   │ │  (AI/ML)    │
              └──────┬──────┘ └──────┬───────┘
                     │               │
                     └───────┬───────┘
                      ┌──────▼──────┐
                      │  MongoDB    │
                      │   Atlas     │
                      └─────────────┘
```

- **Cloudflare Workers** handle edge concerns only — they cannot make raw TCP connections to MongoDB
- **Vercel Serverless** handles app logic and database access from Next.js apps via the Node.js MongoDB driver
- **Fly.io** hosts the Python FastAPI backend for AI inference, model management, and training pipelines (connects via Motor/Beanie)

## Repository Structure

```
shamwari-ai/
├── apps/
│   ├── web/               # shamwari.ai — consumer chat (@shamwari/web)
│   └── platform/          # platform.shamwari.ai — developer portal (@shamwari/platform)
├── packages/
│   └── ui/                # Shared component library (@shamwari/ui)
├── src/                   # Python backend (FastAPI + Beanie ODM) → Fly.io
│   ├── models/            # MongoDB document models (13 collections)
│   ├── db/                # Database initialization
│   └── auth/              # Stytch authentication
├── tasks/                 # Task tracking and lessons
├── Dockerfile             # Docker image for Fly.io deployment
├── fly.toml               # Fly.io deployment config (Johannesburg region)
├── package.json           # Root npm workspace config (Turborepo)
├── turbo.json             # Turborepo pipeline configuration
└── pyproject.toml         # Python project config
```

## Getting Started

### Prerequisites

- Node.js >= 20
- npm >= 10
- Python >= 3.11

### Frontend Development

```bash
# Install all dependencies
npm install

# Start all apps in parallel
npm run dev

# Start individual apps
npm run dev:web          # shamwari.ai on port 3000
npm run dev:platform     # platform.shamwari.ai on port 3001

# Build all apps
npm run build

# Lint all apps
npm run lint

# Type-check all apps
npm run check-types
```

### Python Backend

```bash
# Install Python dependencies
pip install -e ".[dev]"

# Run the FastAPI server locally
uvicorn src.main:app --reload

# Run tests
pytest

# Type-check
mypy src/

# Lint
ruff check src/
```

### Environment Variables

Each app and the Python backend has its own `.env.example`:

| File | Purpose |
|------|---------|
| `.env.example` | Python backend (FastAPI on Fly.io) — MongoDB, Stytch, R2 |
| `apps/web/.env.example` | Web app — MongoDB, Stytch, AI backend URL |
| `apps/platform/.env.example` | Platform app — MongoDB, Stytch, AI backend URL, R2 |

Copy each to `.env` (or `.env.local` for Next.js apps) and fill in your values.

## Contributing

We welcome contributions from anyone who shares our vision of building AI that works for Africa.

### Quick Start

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Make your changes
4. Run tests and linting:
   ```bash
   npm run lint && npm run check-types    # Frontend
   pytest && ruff check src/ && mypy src/ # Python
   ```
5. Commit with a clear message in imperative mood (e.g., "Add Shona tokenizer support")
6. Open a pull request against `main`

### Guidelines

- **Branch strategy**: Feature branches merge into `main` via pull requests
- **Code style**: Readable > clever. Follow existing patterns. Self-documenting code preferred over comments
- **Testing**: Write tests for new functionality. Integration tests for critical paths, unit tests for isolated logic
- **Dependencies**: Pin versions explicitly. Evaluate new deps carefully
- **Database**: MongoDB only — no SQL, D1, or relational databases
- **Africa-first**: Consider bandwidth, compute, and device constraints in your designs

### What to Work On

Check [Issues](https://github.com/nyuchitech/shamwari-ai/issues) for open tasks. Good first issues are tagged accordingly.

## License

MIT — see [LICENSE](LICENSE) for details.

## Organization

Built by **[Nyuchi Africa](https://nyuchi.africa)** (Zimbabwe) through the **Nyuchi Web Services** development division, as part of the **Mukoko** super app ecosystem.
