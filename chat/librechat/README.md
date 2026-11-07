# Shamwari Chat (LibreChat) deployment config

Design and runbook: `docs/librechat.md`. Tracking: #146.

Config as code for LibreChat at `shamwari.ai/chat`, talking only to the gateway.
Nothing here is deployed; creating the Fly app, database, tunnel and secrets are
owner steps in the runbook.

| File                     | Purpose                                                        |
| ------------------------ | -------------------------------------------------------------- |
| `PIN`                    | the exact release tag and commit the image is built from       |
| `librechat.yaml`         | production: one custom endpoint, the gateway                   |
| `librechat.test.yaml`    | test only: adds a personal-scope endpoint for the stub gateway |
| `fly.toml`               | the Fly app; no public port                                    |
| `Dockerfile`, `build.sh` | our config over a build of the pinned commit                   |
| `guard.mjs`, `test/`     | Rule 1 guard and its mutation checks (`npm test`)              |

Not in this change, and tracked in #146: the stub-gateway tests (409, citations,
streaming), the Worker route and its tests, tunnel packaging, the theme overlay,
the first-load weight job.
