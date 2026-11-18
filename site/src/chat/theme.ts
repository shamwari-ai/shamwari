/**
 * Dark or light (issue #329). The page follows the device (tokens.css); a choice made in the command menu is kept on this
 * device and set as data-theme on <html>, which wins over the device. `null` goes back to following the device.
 */
const KEY = 'shamwari.theme';

export function savedTheme(): 'dark' | 'light' | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'light' ? v : null;
  } catch {
    return null;
  }
}

export function applyTheme(theme: 'dark' | 'light' | null, save = false): void {
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
  if (!save) return;
  try {
    if (theme) localStorage.setItem(KEY, theme);
    else localStorage.removeItem(KEY);
  } catch {
    /* the choice holds for this visit only */
  }
}
