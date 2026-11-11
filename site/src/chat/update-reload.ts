/**
 * Updates are forced: the service worker of a new release takes over the moment it is installed (sw.js calls
 * skipWaiting and claims every page), and the page then reloads ONCE to run the new files. Three guards:
 *
 *  - the first install claiming a page that had no worker is not an update, and does not reload;
 *  - never mid-send or mid-draft: the reload waits for `whenIdle` (chat/busy.ts). Messages live in IndexedDB, so
 *    nothing stored is lost either way, offline mode included;
 *  - never a loop: the time of the last update reload is kept in sessionStorage, and a second takeover within
 *    RELOAD_GUARD_MS of it waits out the rest of that window before reloading (a worker that kept replacing itself
 *    would otherwise reload as fast as it could; this way it is at most once a minute, and a real hotfix that follows
 *    straight after a release still reaches the page).
 */
export const RELOAD_GUARD_MS = 60_000;
export const RELOAD_KEY = 'shamwari.updateReload';

export interface ReloadDeps {
  reload: () => void;
  now: () => number;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  whenIdle: (fn: () => void) => void;
  setTimeout: (fn: () => void, ms: number) => void;
}

/** Returns the handler for the service worker container's `controllerchange`. */
export function reloadOnTakeover(hadController: boolean, deps: ReloadDeps): () => void {
  let scheduled = false;
  // A page opened with no worker is claimed by the first install (one controllerchange, nothing to replace); from then
  // on it has a worker, so every later takeover is an update.
  let had = hadController;
  return () => {
    if (!had) {
      had = true;
      return;
    }
    if (scheduled) return;
    let last = 0;
    try {
      last = Number(deps.storage.getItem(RELOAD_KEY)) || 0;
    } catch {
      /* storage blocked: the once-per-page flag below still holds */
    }
    scheduled = true;
    const wait = Math.min(RELOAD_GUARD_MS, RELOAD_GUARD_MS - (deps.now() - last)); // a clock set back never waits longer than the guard
    const go = () =>
      deps.whenIdle(() => {
        try {
          deps.storage.setItem(RELOAD_KEY, String(deps.now()));
        } catch {
          /* as above */
        }
        deps.reload();
      });
    if (wait > 0) deps.setTimeout(go, wait);
    else go();
  };
}

export const UPDATE_CHECK_EVERY_MS = 60 * 60 * 1000;

/**
 * Ask for a newer worker now, whenever the tab comes back to the front, and every hour. The browser fetches sw.js
 * itself (served no-cache, and registered with updateViaCache: 'none'), so a check is never answered from a stale copy.
 */
export function startUpdateChecks(
  reg: { update: () => Promise<unknown> },
  env: { document: Pick<Document, 'addEventListener' | 'visibilityState'>; setInterval: (fn: () => void, ms: number) => unknown },
): void {
  const check = () => {
    void reg.update().catch(() => {
      /* offline, or signed out (the gated shell cannot be fetched): the worker in charge keeps serving */
    });
  };
  check();
  env.document.addEventListener('visibilitychange', () => {
    if (env.document.visibilityState === 'visible') check();
  });
  env.setInterval(check, UPDATE_CHECK_EVERY_MS);
}
