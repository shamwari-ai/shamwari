import { startApp } from './app';
import { LANGUAGES } from './strings';

// The API origin is fixed at build time (PUBLIC_SHAMWARI_API). It is never read
// from the URL: a link that could repoint the app would send a person's key to
// someone else's server.
const apiBase = document.querySelector<HTMLMetaElement>('meta[name="shamwari-api"]')?.content;

const select = document.querySelector<HTMLSelectElement>('#lang');
if (select) {
  for (const [code, { label }] of Object.entries(LANGUAGES)) {
    const o = document.createElement('option');
    o.value = code;
    o.textContent = label;
    o.lang = code;
    select.append(o);
  }
}
// Off unless the build says otherwise (PUBLIC_CHAT_AUTH=mukoko).
const authMode = document.querySelector<HTMLMetaElement>('meta[name="shamwari-auth"]')?.content === 'mukoko' ? 'mukoko' : 'developer-key';
if (apiBase) {
  void startApp({ apiBase, authMode });
}

// Offline shell. Registered after load so it never competes with the first paint,
// and scoped to /lite/ so the marketing pages are never served from it.
if ('serviceWorker' in navigator) {
  // A new build installs in the background and used to wait until every tab was closed. On a phone a tab is
  // almost never closed, so people kept seeing an old build for weeks. Now it takes over as soon as nothing
  // would be lost: the question box is empty (queued questions are already on the device, so a reload keeps
  // them), and the page reloads once into the new build.
  let reloading = false;
  // The first install also fires controllerchange (it claims the page); only a page that already had a worker is reloaded.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading || !document.querySelector('#q')) return;
    reloading = true;
    location.reload();
  });
  const takeOver = (waiting: ServiceWorker) => {
    const go = () => {
      const q = document.querySelector<HTMLTextAreaElement>('#q');
      if (q && q.value.trim() !== '') return false; // someone is writing: try again later
      waiting.postMessage('skip-waiting');
      return true;
    };
    if (go()) return;
    const timer = setInterval(() => go() && clearInterval(timer), 5000);
  };
  addEventListener('load', () => {
    navigator.serviceWorker
      .register('/lite/sw.js', { scope: '/lite/' })
      .then((reg) => {
        // Only an UPDATE is taken over: with no controller this is the first install, which claims by itself.
        const ready = (w: ServiceWorker | null) => {
          if (w && navigator.serviceWorker.controller) takeOver(w);
        };
        ready(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          w?.addEventListener('statechange', () => {
            if (w.state === 'installed') ready(w);
          });
        });
      })
      .catch(() => {
        /* no service worker (private mode, old WebView): the app still works online */
      });
  });
}

// Android/Chrome offers install through this event; iOS has no equivalent, and
// people there use Share, then Add to Home Screen. The button sits in plain view
// (not inside Settings), is never shown to someone already running the installed
// app, and goes away only when the install really happens: a dismissed dialog
// spends the event, and the browser offers a fresh one later.
interface InstallEvent extends Event {
  prompt(): Promise<void>;
}
const installBtn = document.querySelector<HTMLButtonElement>('#install');
const standalone = matchMedia('(display-mode: standalone)').matches;
let offered: InstallEvent | null = null;
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  if (!installBtn || standalone) return;
  offered = e as InstallEvent;
  installBtn.hidden = false;
});
installBtn?.addEventListener('click', () => {
  if (!offered) return;
  const ev = offered;
  offered = null;
  installBtn.hidden = true; // until the browser offers again
  void ev.prompt();
});
addEventListener('appinstalled', () => {
  offered = null;
  if (installBtn) installBtn.hidden = true;
});
