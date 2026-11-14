/**
 * The Plugins / MCP tabs in the drawer (and Skills, only in a build that turns it on: chat/features.ts). Loaded the first time the Plugins section is opened and not before,
 * so the chat's first load does not carry it. Nothing sits behind the tabs yet: each panel says so. This is only the
 * tab behaviour of the WAI-ARIA pattern (arrow keys, Home, End, one tab in the tab order).
 */
export function initPlugins(root: ParentNode = document): void {
  const list = root.querySelector<HTMLElement>('.side-tabs[role="tablist"]');
  if (!list) return;
  const tabs = [...list.querySelectorAll<HTMLElement>('[role="tab"]')];
  const select = (tab: HTMLElement, focus: boolean) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      const panel = document.getElementById(t.getAttribute('aria-controls') ?? '');
      if (panel) panel.hidden = !on;
    }
    if (focus) tab.focus();
  };
  for (const t of tabs) t.addEventListener('click', () => select(t, false));
  list.addEventListener('keydown', (e) => {
    const i = tabs.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    const to =
      e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i + tabs.length - 1) % tabs.length : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    select(tabs[to]!, true);
  });
}
