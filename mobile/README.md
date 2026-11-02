# Shamwari mobile (Expo SDK 58)

iOS and Android app for Shamwari (R1 chat), per `docs/tiered-access-design.md`
and issue #86. ArkTS for HarmonyOS is a separate app and not here.

**Signs in with Mukoko (WorkOS AuthKit, PKCE, no secret)** or, in Expo Go and for testing, a pasted developer key; see `docs/chat-signin.md` ("The mobile app"). **Talks to the Shamwari API only** (`api.shamwari.ai`, `POST /v1/chat/completions`).
No database, no website server, no secrets in the bundle: `EXPO_PUBLIC_*` is
public, so the only such variable is the base URL. The user's key is typed in
Settings and kept in the OS keystore (`expo-secure-store`) as a fallback.

## Rules this app keeps

- **Rule 1.** Scope is always `platform` (the client forces it). A personal-scope
  ask is never queued (`src/lib/queue.ts`). The 409 `scope_requires_local_inference`
  is shown as an explanation, never retried or downgraded.
- **Offline queue + byte budget.** One idempotency key per question, reused on
  retry. Budgets (`src/lib/budget.ts`) are the _assumed_ figures from the design doc.
- **Cited answers.** Citations render as numbered, tappable (http/https only) sources.

## Run

```
cd mobile && npm ci
npx expo start          # open in Expo Go (SDK 58) on a phone
npm run typecheck && npm test
```

## Where the logic lives, and how it is tested

`App.tsx` only draws. Every decision (the offline queue, retry backoff, holding questions when the person
must act, the wipe-first sign-out) is in `src/chat/controller.ts`, with the network, keystore, timers and
ids as injected ports, so `test/controller.test.ts` drives it exactly as the screen does, with no phone.
Sign-in is in `src/auth/` and tested in `test/auth.test.ts`. A test counts only if it fails when its
guard is removed; the main guards in both files (listed in the pull requests that added them) were checked that way. What still needs a real device:
the drawing itself, the keychain, the system browser and a real WorkOS tenant.

llama.rn / on-device Mind needs a development build, not Expo Go (backlog item 11).

## One-time owner step: create the Expo project

The tools available to the build session cannot create an Expo project. On
expo.dev, team `nyuchi-web-services`: create project **shamwari** (slug
`shamwari`), then set **Base directory = `mobile`** in Project settings, connect
the GitHub repo `shamwari-ai/shamwari`, and add the project id as the repo/EAS
variable `EAS_PROJECT_ID`. Then `.eas/workflows/publish-preview-update.yml`
publishes every push to `staging` to the `preview` branch. Builds are
separate and cost money: they need a usage budget first.

## Known duplication

`src/lib/client.ts` and `types.ts` are adapted from `site/src/chat/` (the gateway
contract). They should become one shared package once the site and the app share
a workspace; until then a contract change must be made in both (the gateway tests
and `mobile/test/lib.test.ts` both pin it).
