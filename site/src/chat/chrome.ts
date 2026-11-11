/**
 * Keeps the page's two pinned bars from covering what the page scrolls to.
 *
 * The top bar (sticky, top) and the dock (sticky, bottom) are laid over the page, so the scrollport's
 * visible area is smaller than the window. `scrollIntoView` and focus know nothing about them unless the
 * root says so with `scroll-padding`; without it a new answer is scrolled to y=0 and its first lines sit
 * under the top bar, and the "thinking" bubble is scrolled to the bottom edge, under the dock.
 *
 * Both bars change height (the composer grows with the text, the bar wraps on a narrow screen), so their
 * real heights are measured and written to `--topbar-h` and `--dock-h`, which chat.css turns into
 * `scroll-padding` (the bug and its reproduction: #185). Before this runs, and with no ResizeObserver, chat.css has safe fallbacks.
 */
export function trackChrome(root: HTMLElement = document.documentElement): () => void {
  const bars: Array<[string, string]> = [
    ['[data-slot="app-topbar"]', '--topbar-h'],
    ['.dock', '--dock-h'],
  ];
  const measure = () => {
    for (const [sel, prop] of bars) {
      const el = document.querySelector<HTMLElement>(sel);
      if (el) root.style.setProperty(prop, `${Math.ceil(el.getBoundingClientRect().height)}px`);
    }
  };
  measure();
  if (typeof ResizeObserver === 'undefined') return () => {};
  const ro = new ResizeObserver(measure);
  for (const [sel] of bars) {
    const el = document.querySelector(sel);
    if (el) ro.observe(el);
  }
  return () => ro.disconnect();
}
