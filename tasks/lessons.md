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
