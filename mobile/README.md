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

## The Expo project

EAS project `@nyuchi-web-services/shamwari` (id `3edfc139-4592-48ad-84a3-aacd0f0a9e72`, committed in
`app.config.ts`: an identifier, not a secret). With **Base directory = `mobile`** and the GitHub repo
linked, `.eas/workflows/publish-preview-update.yml` publishes every push to `staging` that touches
`mobile/**` to the `preview` update branch (the workflow validates against the project). Builds are separate
and cost money: they need a usage budget first, and the cost is stated on issue #144 before any is run.
