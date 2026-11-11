import { startUpdateNotice } from './update';
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
startUpdateNotice();

// Offline shell. Registered after load so it never competes with the first paint,
// and scoped to /lite/ so the marketing pages are never served from it.
if ('serviceWorker' in navigator) {
  // A new build installs in the background and waits. The person is told ("A new version is ready") and
  // chooses when to switch (chat/update.ts); only then does the waiting worker take over and the page reload.
  // The first install also fires controllerchange (it claims the page), so only a page that already had a
  // worker reloads.
  let reloading = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    reloading = true;
    location.reload();
  });
  const offer = (waiting: ServiceWorker) => {
    const ask = new Promise<string>((done) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = (e) => done(String(e.data));
      waiting.postMessage('version', [ch.port2]);
      setTimeout(() => done(''), 1500);
    });
    void ask.then((version) =>
      dispatchEvent(new CustomEvent('shamwari:update', { detail: { version, apply: () => waiting.postMessage('skip-waiting') } })),
    );
  };
  // The release this page is running ("v0.0.74"), shown at the foot of the drawer, so a person can tell which they have.
  const showCurrent = (worker: ServiceWorker | null | undefined) => {
    if (!worker) return;
    const ch = new MessageChannel();
    ch.port1.onmessage = (e) => {
      for (const el of document.querySelectorAll('[data-current-version]')) el.textContent = String(e.data);
      for (const el of document.querySelectorAll<HTMLElement>('[data-current-version-line]')) el.hidden = false;
    };
    worker.postMessage('version', [ch.port2]);
  };
  addEventListener('load', () => {
    navigator.serviceWorker
      .register('/lite/sw.js', { scope: '/lite/' })
      .then((reg) => {
        showCurrent(navigator.serviceWorker.controller ?? reg.active);
        // Only an UPDATE is offered: with no controller this is the first install, which claims by itself.
        const ready = (w: ServiceWorker | null) => {
          if (w && navigator.serviceWorker.controller) offer(w);
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
