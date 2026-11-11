/**
 * "A new version is ready". The service worker installs a new build in the background and waits; the person is
 * told and chooses when to switch (switching reloads the page). While the drawer is closed the notice is a small
 * pop-up above the question box; when the drawer opens the pop-up goes away and the same notice is a card at the
 * bottom of the drawer, above the New chat and account buttons. "Later" hides the pop-up; the card stays until the
 * update is taken.
 *
 * main.ts raises `shamwari:update` ({ version, apply }) when a worker is waiting. The text is static in the page
 * (translated like everything else); only the version number is filled in here.
 */
export function startUpdateNotice(): void {
  const popup = document.querySelector<HTMLElement>('#update');
  const card = document.querySelector<HTMLElement>('#update-card');
  const drawer = document.querySelector<HTMLElement>('#chat-sidebar');
  if (!popup || !card) return;

  let pending = false;
  let later = false;
  let open = false;
  const sync = () => {
    popup.hidden = !pending || later || open;
    card.hidden = !pending;
  };

  drawer?.addEventListener('toggle', (e) => {
    open = (e as ToggleEvent).newState === 'open';
    sync();
  });

  addEventListener('shamwari:update', (e) => {
    const { version, apply } = (e as CustomEvent<{ version?: string; apply: () => void }>).detail;
    for (const el of document.querySelectorAll('[data-update-version]')) el.textContent = version ?? '';
    for (const el of document.querySelectorAll('[data-update-has-version]')) (el as HTMLElement).hidden = !version;
    pending = true;
    later = false;
    sync();
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-update-now]')) {
      b.onclick = () => {
        for (const x of document.querySelectorAll<HTMLButtonElement>('[data-update-now]')) {
          x.disabled = true;
          x.setAttribute('aria-busy', 'true');
        }
        apply();
      };
    }
  });

  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-update-later]')) {
    b.addEventListener('click', () => {
      later = true;
      sync();
    });
  }
}
