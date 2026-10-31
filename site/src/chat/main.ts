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
