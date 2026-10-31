import { applyStrings, currentLanguage, saveLanguage } from './i18n';
import { LANGUAGES, isLanguage } from './strings';

const lang = currentLanguage();
const select = document.querySelector<HTMLSelectElement>('#lang');
if (select) {
  select.innerHTML = '';
  for (const [code, { label }] of Object.entries(LANGUAGES)) {
    const o = document.createElement('option');
    o.value = code;
    o.textContent = label;
    o.lang = code;
    select.append(o);
  }
  select.value = lang;
  select.addEventListener('change', () => {
    if (!isLanguage(select.value)) return;
    saveLanguage(select.value);
    applyStrings(document, select.value);
  });
}
applyStrings(document, lang);
