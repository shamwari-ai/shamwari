// The canonical "where things actually stand" list. /project/ renders all
// of it; the homepage renders the `highlight`-ed subset. One list so the
// two pages can't quietly drift apart on the same underlying facts —
// see site/README.md's "Keeping this honest".
import { REPO } from '../lib/site';

/** When the corpus was last checked for loaded content. One place, so every page that says it agrees. */
export const CORPUS_LAST_CHECKED = '31 October 2026';

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
    title: 'The sources behind every answer',
    body: `Sources are reviewed and approved one at a time: we use what we have the right to use, nothing scraped first and asked about later. The order is farming information from Nyuchi-owned and licence-clean sources first, the Constitution of Zimbabwe second, and law and tax after that, once the Acts have a licence we can use. When we last checked (${CORPUS_LAST_CHECKED}) nothing was loaded, so Shamwari cannot cite a real source yet. ZimLII, a free library of Zimbabwean law, licenses its legislation for non-commercial use by default, though some collections differ, which does not fit a commercial service, so it stays out until we have its permission.`,
    issues: [17, 18],
    highlight: true,
  },
  {
    state: 'building',
    title: 'Shamwari API',
    body: 'An OpenAI-style API for Shamwari Cloud. The gateway is running and answers, but it accepts no key yet: the service behind it is not deployed and the key store is still being built. How developers get keys is not decided.',
    issues: [19],
  },
  {
    state: 'building',
    title: 'Shamwari Chat',
    body: 'Ask in English, Shona or Ndebele and get the answer with the section it came from. The Shona and Ndebele wording is still a draft that native speakers have not yet reviewed. An early test version of the lightweight app, which installs from the browser and is built for slow connections, is online at shamwari.ai/lite, apart from this marketing site. It does not answer real questions yet: the service behind it is not deployed and sign-in is not switched on. Sign-in will use your Mukoko Account. The main chat will live at shamwari.ai/chat.',
    issues: [83],
  },
  {
    state: 'building',
    title: 'Shamwari mobile app',
    body: 'An Android and iPhone app built with Expo: the same chat with a queue for questions asked offline, English, Shona and Ndebele (drafts), and sign-in with your Mukoko Account. It is built and tested in code but not yet tried on a phone, and it is not in any app store.',
    issues: [144],
  },
  {
    state: 'planned',
    title: 'Shamwari CLI',
    body: 'Shamwari in your terminal, for people who work there. Not built yet.',
  },
  {
    state: 'planned',
    title: 'Shamwari MCP server',
    body: 'Connect Shamwari’s cited answers to your own agents and tools. Not built yet.',
  },
  {
    state: 'planned',
    title: 'Shamwari Factory',
    body: 'The coding agent: create projects and build in a sandbox, working in your GitHub repositories. Available to paying customers only. Not built yet.',
    issues: [66],
  },
  {
    state: 'building',
    title: 'Shamwari for GitHub',
    body: 'A GitHub App and MCP server that reviews pull requests and works with issues. It is deployed, and for now limited to a short list of Nyuchi repositories and to our own team. It comments and never approves or merges. Opening it to your repositories comes with Factory.',
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
