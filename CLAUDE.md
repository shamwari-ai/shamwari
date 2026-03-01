# CLAUDE.md — Shamwari AI

## Project Overview

**Shamwari AI** is Nyuchi Africa's open source initiative to build a localized AI model and platform purpose-built for the African continent. The name "shamwari" means "friend" in Shona, reflecting the project's goal of creating AI that understands and serves African communities.

- **Organization**: Nyuchi Web Services (Nyuchi Africa)
- **License**: MIT
- **Repository**: `nyuchitech/shamwari-ai`
- **Status**: Early-stage / greenfield project

## Repository Structure

```
shamwari-ai/
├── CLAUDE.md          # This file — guidance for AI assistants
├── LICENSE            # MIT License
└── README.md          # Project description
```

This is a greenfield repository. The codebase structure will evolve as development progresses. When adding new code, follow the conventions outlined below.

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

When adding new code to this repository:

- Place source code in a `src/` directory.
- Place tests alongside source files or in a dedicated `tests/` directory, mirroring the source structure.
- Place configuration files at the project root.
- Place documentation in a `docs/` directory for anything beyond the README.
- Keep the root directory clean — avoid cluttering it with too many files.

### Testing

- Write tests for all new functionality.
- Tests should be runnable with a single command documented in the README or package configuration.
- Prefer integration tests for critical paths and unit tests for isolated logic.

### Dependencies

- Pin dependency versions explicitly for reproducibility.
- Evaluate new dependencies carefully — prefer well-maintained, widely-used libraries.
- Document any system-level dependencies or prerequisites in the README.

## AI Assistant Guidelines

### Working on This Repository

1. **Read before writing**: Always read existing files before modifying them. Understand the context.
2. **Minimal changes**: Make only the changes necessary to accomplish the task. Do not refactor surrounding code unless explicitly asked.
3. **Respect existing patterns**: If conventions are established in the codebase, follow them even if you'd do it differently.
4. **No speculative code**: Don't add features, error handling, or abstractions beyond what is requested.
5. **Security first**: Never commit secrets, API keys, or credentials. Check for OWASP top 10 vulnerabilities in any code you write.
6. **Test your work**: If a test framework is configured, run tests after making changes.

### Context About the Project

- This project targets **African localization** — models, datasets, and tooling should prioritize African languages, contexts, and use cases.
- Consider **resource constraints** common on the continent (bandwidth, compute, device capabilities) when making architectural decisions.
- **Multilingual support** is a core concern — designs should accommodate multiple languages from the outset.
- The project is **open source** and community-driven. Code should be approachable for contributors of varying experience levels.

### What to Avoid

- Do not add documentation files (README, guides, etc.) unless explicitly asked.
- Do not create CI/CD pipelines or deployment configurations without instruction.
- Do not introduce heavy frameworks or dependencies without discussion.
- Do not restructure the repository layout without explicit approval.
