// Site-wide constants and nav data. Single source so a rename or a link
// change doesn't need to be repeated across Header, Footer, Layout's
// breadcrumb labels, and every page that links to GitHub or mailto.

export const REPO = 'https://github.com/bundu-labs/shamwari';
export const CONTACT_EMAIL = 'hello@shamwari.ai';

/**
 * Where "Open chat" goes: the MAIN Shamwari Chat at /chat/ on the apex, owned by a separate
 * build, never a path on this site. It is not the light edge chat this repository's app serves
 * at /lite/. "Open chat" is only shown once that is released (PUBLIC_CHAT_LIVE=true at build
 * time); until /chat/ answers, a link to it would be a dead end that says the chat is ready
 * when it is not, so do not set the flag before then.
 */
export const CHAT_URL = 'https://shamwari.ai/chat/';
export const CHAT_LIVE = import.meta.env.PUBLIC_CHAT_LIVE === 'true';

export interface NavItem {
  path: string;
  label: string;
  external?: boolean;
}

// The full set of pages, used to derive Header links, Footer links, and
// breadcrumb labels. Each consumer picks the subset it needs (Header
// excludes Home/Contact since those are the logo and the CTA button;
// Footer excludes Contact since it has its own "Get in touch" column) —
// the label text itself stays in one place either way.
export const PAGES: NavItem[] = [
  { path: '/', label: 'Home' },
  { path: '/blueprint/', label: 'Blueprint' },
  { path: '/project/', label: 'Project' },
  { path: '/contact/', label: 'Contact' },
  { path: 'https://docs.shamwari.ai', label: 'Documentation', external: true },
];

// deriveBreadcrumbs (@bundu/ui) wants a segment -> label map, not full paths.
export const BREADCRUMB_LABELS: Record<string, string> = Object.fromEntries(
  PAGES.filter((p) => !p.external && p.path !== '/').map((p) => [p.path.replace(/\//g, ''), p.label]),
);


// Mirrors the { target, rel } spread @bundu/ui's Button/Card already do
// internally for an external link — used by local components (Header,
// Footer) that render plain <a> tags instead of <Button>/<Card>.
export function externalLinkAttrs(external?: boolean) {
  return external ? { target: '_blank', rel: 'noopener noreferrer' } : {};
}
