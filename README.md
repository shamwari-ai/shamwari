# Shamwari AI

**Shamwari AI** is [Nyuchi Africa's](https://nyuchi.africa) open source initiative to build a localized AI model and platform purpose-built for the African continent. The name "shamwari" means "friend" in Shona.

Shamwari is not trying to be GPT. It's the AI that actually works for Africa: small enough to run locally, smart enough to be useful, culturally grounded, and commercially sustainable.

## Two Core Pillars

**The Model** — A small, efficient language model (1B-7B parameters) designed for on-device inference across affordable hardware. Deep multilingual support for African languages starting with Shona and Ndebele.

**The Platform** — A full-stack AI platform with two web properties:
- **shamwari.ai** — Consumer-facing AI chat application
- **platform.shamwari.ai** — Developer and business portal (API keys, usage dashboards, billing, documentation)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, Tailwind CSS v4, shadcn/ui |
| Monorepo | Turborepo, npm workspaces |
| Backend | Python (FastAPI), Cloudflare Workers |
| Inference | Rust (GGUF/ONNX) |
| Database | MongoDB (Beanie ODM) |
| Auth | Stytch (Mukoko B2C) |
| Storage | Cloudflare R2 |
| Deployment | Vercel (frontend), Cloudflare (backend) |

## Repository Structure

```
shamwari-ai/
├── apps/
│   ├── web/               # shamwari.ai — consumer chat (@shamwari/web)
│   └── platform/          # platform.shamwari.ai — developer portal (@shamwari/platform)
├── packages/
│   └── ui/                # Shared component library (@shamwari/ui)
├── src/                   # Python backend (FastAPI + Beanie ODM)
│   ├── models/            # MongoDB document models
│   ├── db/                # Database initialization
│   └── auth/              # Stytch authentication
├── tasks/                 # Task tracking and lessons
├── package.json           # Root npm workspace config
├── turbo.json             # Turborepo pipelines
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

# Start all apps
npm run dev

# Start individual apps
npm run dev:web          # shamwari.ai on port 3000
npm run dev:platform     # platform.shamwari.ai on port 3001

# Build all apps
npm run build

# Type-check
npm run check-types
```

### Python Backend

```bash
# Install Python dependencies
pip install -e ".[dev]"

# Run tests
pytest

# Type-check
mypy src/

# Lint
ruff check src/
```

## License

MIT — see [LICENSE](LICENSE) for details.

## Organization

Built by **Nyuchi Africa** (Zimbabwe) through the **Nyuchi Web Services** development division, as part of the **Mukoko** super app ecosystem.
