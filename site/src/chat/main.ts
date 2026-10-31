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
if (apiBase) {
  void startApp({ apiBase });
}

// Offline shell. Registered after load so it never competes with the first paint,
// and scoped to /chat/ so the marketing pages are never served from it.
if ('serviceWorker' in navigator) {
  addEventListener('load', () => {
    void navigator.serviceWorker.register('/chat/sw.js', { scope: '/chat/' }).catch(() => {
      /* no service worker (private mode, old WebView): the app still works online */
    });
  });
}

// Android/Chrome offers install through this event; iOS has no equivalent, and
// people there use Share, then Add to Home Screen.
interface InstallEvent extends Event {
  prompt(): Promise<void>;
}
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  const btn = document.querySelector<HTMLButtonElement>('#install');
  if (!btn) return;
  btn.hidden = false;
  btn.addEventListener('click', () => {
    void (e as InstallEvent).prompt();
    btn.hidden = true;
  });
});
