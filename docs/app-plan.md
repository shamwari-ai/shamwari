# The native app: scope, what is shared, and the smallest path to a store

Tracking: #86 (under #83). Web app it builds on: `docs/chat-app.md`. Status:
**plan only, no native code started.** Every number below is _unmeasured_
unless it says otherwise.

## What a native app is for

The installable PWA already gives people the chat, the citations, the offline
queue and Add to Home Screen. A native app is worth its cost only for what the
web cannot do:

| A native shell adds                                                                                                                                                                                  | Why the PWA cannot                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **App-store distribution and discovery** (Play, App Store, AppGallery)                                                                                                                               | A PWA is found by link, not by search in a store. For many people "an app" means a store listing.                                         |
| **Shamwari Mind on the device** (llama.rn / llama.cpp, a downloaded model, resumable and Wi-Fi first)                                                                                                | A browser cannot hold a multi-GB model reliably or run it fast. Mind is the only place personal scope may be answered (CLAUDE.md rule 1). |
| **A queue that flushes in the background** (OS background tasks)                                                                                                                                     | The PWA flushes while its tab is open. Background Sync is unsupported on iOS and uneven on low-end Android WebViews.                      |
| **Push**: for example "your question was answered" after a long offline stretch. FCM and APNs; HMS Push or polling on Huawei phones without Google services. No question or answer text in the push. | Web push on iOS needs the PWA to be installed, and is unreliable on the devices in scope.                                                 |
| **Secure key storage** (Keychain, Keystore) instead of `localStorage`                                                                                                                                | Removes the one real weakness in the web sign-in proposal.                                                                                |
| **Voice** input and output, once #8 says which languages work                                                                                                                                        | Shona and Ndebele speech is unmeasured; native audio APIs are steadier.                                                                   |

The ladder stays as in `docs/tiered-access-design.md`: R3 is Mind on the device;
without Mind the app behaves as R1/R2 and says plainly that personal questions
need Mind.

## What is shared with the PWA

The decision in #86 is **shared contract, not shared code across Expo and
ArkTS**. Between the PWA and Expo, which are both TypeScript, more can be
literally shared.

| Piece                                                                                       | Where it is today                        | Shared with Expo?                                                                                                         | With ArkTS?                                               |
| ------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Typed gateway client (every failure mapped to a kind, `Idempotency-Key`, `onProgress` seam) | `site/src/chat/client.ts`, `types.ts`    | **Yes, as code.** It uses only `fetch` and `AbortController`, no DOM.                                                     | Contract only: the same kinds and rules, in ArkTS.        |
| Citation and answer data model                                                              | `types.ts` (`Citation`, `Answer`)        | **Yes, as code.**                                                                                                         | Contract only.                                            |
| UI strings, en/sn/nd, with the "needs native review" flag                                   | `site/src/chat/strings.ts`               | **Yes, as data.** One source, so a native reviewer signs off once.                                                        | Generated from the same source.                           |
| Queue and idempotency rules (queued, sent, failed; id is the key; oldest first; backoff)    | `app.ts`, entangled with the DOM today   | **Yes, after extracting a pure `queue` module** (storage and timers injected).                                            | Contract plus test vectors.                               |
| Scope-gate behaviour (never send `personal`; render the 409 as the Mind explanation)        | `app.ts`, `render.ts`                    | Rules shared; rendering is per platform.                                                                                  | Same.                                                     |
| **Conformance vectors**                                                                     | the mock's fixtures and `client.test.ts` | **Yes.** Move to JSON vectors (request, status, headers, body, expected kind) that the PWA, Expo and ArkTS all run in CI. | Yes: this is how ArkTS stays honest without sharing code. |
| Mzizi tokens                                                                                | CSS custom properties from `@bundu/ui`   | Mzizi has React Native token nodes (registry 4.0.36).                                                                     | ArkTS tokens, per #86 item 13.                            |

Not shared: the UI (DOM versus React Native versus ArkUI), IndexedDB (becomes
`expo-sqlite`), the service worker and CSP, and the install flow.

**Proposed, not started:** when Expo work begins, move `client.ts`, `types.ts`,
`strings.ts` and the extracted queue into `packages/chat-core/` as a workspace
package that the site and the Expo app both import. Doing it now, with one
consumer, would be structure with nothing to prove it right.

## The smallest honest path to a store submission

Smallest does not mean thinnest. Apple rejects apps that are little more than a
website in a wrapper (App Store Review Guideline 4.2), so a WebView shell of the
PWA is not a safe iOS plan; check the current guideline text before relying on
this. Google Play is more permissive.

1. **Prerequisite, not optional: real sign-in.** A store app cannot ship a
   screen that asks people to paste a developer key. The Mukoko Account flow and
   the per-person key route in `docs/chat-app.md` have to exist first. Apple
   also expects account deletion from inside the app where accounts can be
   created, and has rules about offering other sign-in options; both need
   checking against Mukoko Account's design. This is the same dependency the
   web app has, so it is on the critical path for both.
2. **Android first, with the least new code: a Trusted Web Activity** (a
   Play-listed wrapper around the installed PWA, built with Bubblewrap). It
   needs Digital Asset Links on `shamwari.ai` and a Play developer account. No
   new UI. It gets the Play listing, not push, background queue or Mind. Whether
   AppGallery accepts the same package, and on what terms, is **not checked**.
3. **Expo app, in this order**: extract `packages/chat-core`; a development
   build (not Expo Go) with a chat screen using it, `expo-sqlite` history,
   `expo-secure-store` for the key; the offline queue with a background task;
   EAS builds to TestFlight and Play internal testing.
4. **Measure before committing** (#86 item 11): install size, cold start and
   memory of a React Native app on a ~2 GB Go-class phone. That number decides
   whether the Android build is Expo or a thin native shell for those devices.
5. **Store submission**: listing and screenshots (real answers with real
   citations, once there are any), privacy policy URL, Apple's privacy details
   and Google's Data safety form (questions are sent to the Shamwari API, so they
   are disclosed; nothing is sold or shared), age rating, review.
6. **Later, behind their own issues**: Mind and its model delivery (needs the
   base-model decision in #78 and Ground packs, #83 item 5); HMS Push and the
   AppGallery build for Huawei Android phones; the ArkTS app for HarmonyOS NEXT
   (#86 items 12 and 13), after the device count there is established.

Nothing in steps 2 to 5 puts personal scope on Cloud: the app never sends
`scope: personal` to the gateway until Mind exists on the device, and Shamwari
Cloud is described as a routed model, never as sovereign.

## Needs the owner

- Apple Developer and Google Play accounts; Huawei AppGallery Connect account
  and programme terms (already listed in #86).
- The decision between a TWA now (fast Android, no iOS) and waiting for Expo
  (one codebase, slower).
- Mukoko sign-in and the per-person key route, which gate both the web app's
  public launch and any store submission.
- Test devices: a ~2 GB Go-class Android, an iPhone, and a HarmonyOS NEXT phone.
- A privacy policy page on shamwari.ai (the site has none yet).
