# Shamwari Chat proxy Worker

Design: `docs/librechat.md`, "Sub-path hosting". Tracking: #146.

The reverse proxy that puts LibreChat at `https://shamwari.ai/chat`. LibreChat's
server mounts everything at the root, so this strips `/chat`, re-prefixes
redirects, scopes cookies to `Path=/chat`, and adds the same-origin security
headers.

**Nothing here is live.** `wrangler.jsonc` declares no route, custom domain,
public URL or binding, and `npm test` fails if one appears. Without the
`CHAT_ORIGIN` binding the Worker answers 503 and contacts nothing.

| Path                 | Purpose                                               |
| -------------------- | ----------------------------------------------------- |
| `src/rewrite.js`     | pure rules: scope, prefix, `Location`, cookies, CSP   |
| `src/index.js`       | the Worker; reaches the origin only via `CHAT_ORIGIN` |
| `test/proxy.test.js` | unit tests, no dependencies (`npm test`)              |

## Owner steps (not done)

1. After the Fly app and tunnel exist, add the `CHAT_ORIGIN` binding (a Workers
   VPC service, or a service binding) to `wrangler.jsonc`.
2. Deploy the Worker (`wrangler deploy`), reach it on a preview hostname, and run
   the checks in the cutover list.
3. Cutover step 7: attach `shamwari.ai/chat` and `shamwari.ai/chat/*`.
