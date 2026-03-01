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
| Compute | Cloudflare Workers | All serverless backend — API gateway, auth, rate limiting, serving chat and platform interfaces |
| Database | MongoDB | User accounts, API keys, usage tracking, conversation history, billing (NOT SQL/D1) |
| Storage | Cloudflare R2 | Model artifacts, file uploads, static assets |
| Model | Custom (1B–7B) | On-device + cloud inference, African language focus |

### Architecture Principles

- **Cloudflare Workers** for all backend services — no traditional server infrastructure
- **MongoDB** as the sole data layer — do not use SQL, D1, or other relational databases
- **R2** for all object/blob storage needs — model weights, uploads, assets
- **Fully open source** — every component from model weights to platform code designed for open distribution and community contribution

## Repository Structure

```
shamwari-ai/
├── CLAUDE.md              # This file — guidance for AI assistants
├── LICENSE                # MIT License
├── README.md              # Project description
├── tasks/
│   ├── todo.md            # Current task tracking with checkable items
│   └── lessons.md         # Accumulated lessons and patterns from corrections
├── src/                   # Source code (as project grows)
├── tests/                 # Test files mirroring src/ structure
└── docs/                  # Extended documentation
```

This is a greenfield repository. Structure will evolve as development progresses. Follow the conventions in this document when adding code.

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

- Place source code in `src/`.
- Place tests alongside source files or in `tests/`, mirroring the source structure.
- Place configuration files at the project root.
- Place extended documentation in `docs/`.
- Keep the root directory clean.

### Testing

- Write tests for all new functionality.
- Tests should be runnable with a single command documented in the package configuration.
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
- **Usage tracking and billing** — all stored in MongoDB, surfaced through platform.shamwari.ai dashboards

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
6. Use MongoDB for all data persistence — never introduce SQL or D1.
7. Use Cloudflare Workers for backend — never introduce traditional server frameworks.

### After Finishing

1. Prove your work is correct — run tests, check logs, demonstrate behavior.
2. Update `tasks/todo.md` with completed items and review notes.
3. If you received a correction, update `tasks/lessons.md` with the lesson.

### What to Avoid

- Do not add documentation files unless explicitly asked.
- Do not create CI/CD pipelines or deployment configurations without instruction.
- Do not introduce heavy frameworks or dependencies without discussion.
- Do not restructure the repository layout without explicit approval.
- Do not use SQL, D1, or any relational database — MongoDB only.
- Do not propose solutions that ignore African resource constraints (bandwidth, compute, device capabilities).
