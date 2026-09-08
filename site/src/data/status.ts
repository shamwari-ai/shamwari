// The canonical "where things actually stand" list. /project/ renders all
// of it; the homepage renders the `highlight`-ed subset. One list so the
// two pages can't quietly drift apart on the same underlying facts —
// see site/README.md's "Keeping this honest".
import { REPO } from '../lib/site';

export type Status = 'live' | 'building' | 'planned';

export interface StatusItem {
  state: Status;
  title: string;
  body: string;
  issues?: number[];
  highlight?: boolean;
}

export const STATUS: StatusItem[] = [
  {
    state: 'live',
    title: 'The architecture, in writing',
    body: 'docs.shamwari.ai documents exactly how routing, sovereignty and citation work, and it’s checked against the real code.',
    highlight: true,
  },
  {
    state: 'live',
    title: 'Data sovereignty enforcement',
    body: 'The two rules on the Blueprint page are live in code, enforced at more than one layer, and covered by tests — not policy on a page.',
  },
  {
    state: 'live',
    title: "Ground's storage and search",
    body: 'The database and search indexes behind retrieval are running and ready.',
  },
  {
    state: 'building',
    title: 'The Zimbabwean legal and tax corpus',
    body: 'Sources are being reviewed and approved one at a time — we ingest what we have the rights to, nothing scraped first and asked about later. The Constitution of Zimbabwe is first in.',
    issues: [17, 18],
    highlight: true,
  },
  {
    state: 'building',
    title: 'Shamwari Cloud',
    body: 'The gateway and API are written and tested, and not yet serving production traffic.',
    issues: [19],
  },
  {
    state: 'planned',
    title: 'Shamwari Mind',
    body: 'The on-device, open-weight model — the part that makes the sovereignty promise real for everyday use, not just for the API.',
    issues: [20],
    highlight: true,
  },
  {
    state: 'planned',
    title: 'Voice and image',
    body: 'Including Shona and Ndebele speech, once a provider actually supports them well.',
    issues: [21],
  },
];

export const issueUrl = (n: number) => `${REPO}/issues/${n}`;
