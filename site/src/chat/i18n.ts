import { LANGUAGES, isLanguage, pickLanguage, type Strings } from './strings';
import type { Language } from './types';

const KEY = 'shamwari.lang';

export function currentLanguage(): Language {
  try {
    const saved = localStorage.getItem(KEY);
    if (isLanguage(saved)) return saved;
  } catch {
    /* storage can be blocked; fall through to the browser's choice */
  }
  return pickLanguage(navigator.languages?.length ? navigator.languages : [navigator.language]);
}

export function saveLanguage(lang: Language): void {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* not fatal: the choice just does not persist */
  }
}

/** Resolve "errors.offline" against a Strings object. Missing keys return the path, loudly. */
export function lookup(strings: Strings, path: string): string {
  let cur: unknown = strings;
  for (const part of path.split('.')) {
    cur = (cur as Record<string, unknown> | undefined)?.[part];
  }
  return typeof cur === 'string' ? cur : path;
}

/**
 * Translate a subtree. Elements opt in with `data-i18n="key"` (text) and
 * `data-i18n-attr="placeholder:key;aria-label:key"` (attributes), so the page
 * is complete English HTML without JavaScript and is translated on top.
 */
export function applyStrings(root: ParentNode, lang: Language): void {
  const { strings } = LANGUAGES[lang];
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = lookup(strings, el.dataset.i18n!);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-attr]').forEach((el) => {
    for (const pair of el.dataset.i18nAttr!.split(';')) {
      const [attr, key] = pair.split(':');
      if (attr && key) el.setAttribute(attr.trim(), lookup(strings, key.trim()));
    }
  });
  document.documentElement.lang = lang;
  root.querySelectorAll<HTMLElement>('[data-review-note]').forEach((el) => {
    el.hidden = !LANGUAGES[lang].needsNativeReview;
  });
}
