# Shamwari AI — Task Tracking

## Frontend: Turborepo Monorepo Setup

- [x] Create `.gitignore` (Node.js + Python combined)
- [x] Create root `package.json` with npm workspaces (`apps/*`, `packages/*`)
- [x] Create `turbo.json` pipeline config (build, dev, lint, check-types)
- [x] Scaffold `apps/web` — Next.js 16 + shadcn/ui (Stone theme, Noto Sans, Lucide, large radius)
- [x] Adapt `apps/web` for monorepo — `@shamwari/web` namespace, `transpilePackages`, tsconfig paths
- [x] Scaffold `apps/platform` — Same shadcn preset, port 3001, `@shamwari/platform` namespace
- [x] Create `packages/ui` — Shared component library (`@shamwari/ui`) with `cn()` utility, theme CSS, exports map
- [x] Add `vercel.json` to both apps — workspace-aware install/build commands
- [x] Verify: `npm install` resolves all workspaces, TypeScript type-checks pass
- [x] Commit and push to `claude/add-claude-documentation-4BVFW`

---

# Data Model Architecture Plan

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENTS                                   │
│  shamwari.ai (Next.js)    platform.shamwari.ai (Next.js)        │
└──────────────┬───────────────────────┬──────────────────────────┘
               │                       │
               ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│              CLOUDFLARE WORKERS (Edge Layer)                      │
│  • Stytch JWT validation    • Rate limiting                      │
│  • Request routing          • CORS / security headers            │
│  • MongoDB Data API calls   • Static asset serving (R2)          │
└──────────────┬───────────────────────┬──────────────────────────┘
               │                       │
       ┌───────┘                       └────────┐
       ▼                                        ▼
┌──────────────────────┐          ┌──────────────────────────────┐
│   PYTHON (FastAPI)   │          │   RUST (Inference Engine)    │
│  • Business logic    │          │  • Model loading (GGUF/ONNX) │
│  • API endpoints     │◄────────►│  • Token generation          │
│  • Stytch SDK        │          │  • Quantized inference       │
│  • Beanie ODM        │          │  • Batch processing          │
└──────────┬───────────┘          └──────────────────────────────┘
           │
           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    MONGODB ATLAS                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │  Data API   │  │  Triggers   │  │  Functions              │ │
│  │  (REST)     │  │  (DB/Cron)  │  │  (Serverless JS)        │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
│                                                                  │
│  Collections: users, organizations, api_keys, conversations,    │
│  messages, models, billing_plans, subscriptions, invoices,      │
│  usage_records, datasets, feedback, audit_logs                  │
└─────────────────────────────────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CLOUDFLARE R2                                  │
│  • Model artifacts (weights, configs)                            │
│  • Training datasets                                             │
│  • User file uploads                                             │
│  • Static assets                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Auth Flow: Stytch + MongoDB

```
User → Stytch (Mukoko B2C) → JWT issued
                                 │
                                 ▼
               Cloudflare Worker validates JWT (JWKS)
                                 │
                                 ▼
               Python backend extracts stytch_user_id
                                 │
                                 ▼
               MongoDB: find or create user doc by stytch_user_id
```

- Stytch handles: signup, login (magic link, OAuth, OTP), sessions, MFA
- MongoDB stores: application data linked by stytch_user_id
- No passwords stored in MongoDB — Stytch owns the credential layer

## MongoDB App Services Usage (No Built-in Auth)

| Service        | Purpose                                                    |
|----------------|------------------------------------------------------------|
| Data API       | Workers edge reads (lightweight queries without drivers)    |
| DB Triggers    | React to inserts/updates (usage aggregation, notifications) |
| Scheduled Triggers | Cron jobs (billing cycles, cleanup, reports)           |
| Functions      | Serverless JS logic (aggregation pipelines, webhooks)       |

## Collections (13 total)

### Core Identity
- [x] `users` — User accounts (stytch_user_id reference, roles, preferences)
- [x] `organizations` — Business/team accounts for platform API access

### API Access
- [x] `api_keys` — Developer API keys (hashed, scoped, rate-limited)

### Chat / AI
- [x] `conversations` — Chat sessions (user-owned, model-linked)
- [x] `messages` — Individual messages (role, content, tokens, latency)
- [x] `models` — AI model registry (versions, languages, pricing, capabilities)

### Billing
- [x] `billing_plans` — Pricing tiers (Free, Starter, Pro, Enterprise)
- [x] `subscriptions` — Active subscriptions (org-linked, period tracking)
- [x] `invoices` — Payment records (line items, status, periods)

### Analytics & Operations
- [x] `usage_records` — API usage time-series (tokens, latency, endpoints)
- [x] `datasets` — Training dataset registry (R2-stored, language-tagged)
- [x] `feedback` — User ratings on AI responses (thumbs up/down, categories)
- [x] `audit_logs` — System audit trail (who did what when)

## Implementation Tasks

- [x] Create Python project structure with pyproject.toml
- [x] Implement base document model (Beanie ODM)
- [x] Implement User model with Stytch integration
- [x] Implement Organization model with embedded members
- [x] Implement APIKey model with hashing
- [x] Implement Conversation model
- [x] Implement Message model
- [x] Implement AI Model registry
- [x] Implement BillingPlan, Subscription, Invoice models
- [x] Implement UsageRecord (time-series optimized)
- [x] Implement Dataset model
- [x] Implement Feedback model
- [x] Implement AuditLog model
- [x] Create database initialization module
- [x] Commit and push

## Design Decisions

### Embedding vs. Referencing

| Relationship | Strategy | Reasoning |
|-------------|----------|-----------|
| User → preferences/settings | Embed | Small, always read together, 1:1 |
| Organization → members | Embed | Small array (<100), read together, avoids joins |
| Organization → billing info | Embed | 1:1, always read together |
| Conversation → messages | Reference | Messages grow unbounded, 16MB doc limit |
| Model → pricing | Embed | Small, 1:1, always read together |
| Model → supported_languages | Embed | Small array, always read together |
| Invoice → line_items | Embed | Small array, always read together |
| Usage → details | Flat doc | High-volume writes, time-series pattern |

### Indexing Strategy

| Collection | Indexes | Purpose |
|-----------|---------|---------|
| users | `stytch_user_id` (unique), `email` (unique) | Auth lookup, dedup |
| organizations | `slug` (unique), `owner_id` | URL routing, ownership |
| api_keys | `key_hash` (unique), `organization_id` | Auth, org listing |
| conversations | `user_id + created_at`, `user_id + is_archived` | User's chats, sorted |
| messages | `conversation_id + created_at` | Chat history, ordered |
| models | `slug + version` (unique), `status` | Lookup, active models |
| usage_records | `timestamp` (TTL), `api_key_id + timestamp`, `organization_id + timestamp` | Time-series queries |
| feedback | `model_id + created_at`, `rating` | Model analytics |
| audit_logs | `timestamp` (TTL), `actor_id`, `resource_type + resource_id` | Investigation |

### TTL Policies

| Collection | TTL | Reasoning |
|-----------|-----|-----------|
| usage_records | 90 days (raw), aggregated data kept indefinitely | Cost control, raw data is high volume |
| audit_logs | 365 days | Compliance, investigation window |
