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
    body: 'Sources are being reviewed and approved one at a time: we ingest what we have the rights to, nothing scraped first and asked about later. As of 31 October 2026 nothing is loaded, so Shamwari cannot cite a real source yet. The Constitution of Zimbabwe goes in first. ZimLII, a free library of Zimbabwean law, licenses its legislation for non-commercial use by default, though some collections differ, which does not fit a commercial service, so it stays out until we have its permission.',
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
    body: 'Ask in Shona, Ndebele or English and get the answer with the section it came from. A lightweight app that installs from the browser and is built for slow connections. It is being built and tested against a stand-in for the API; it is not live yet and does not answer real questions yet. It will live at shamwari.ai/chat, apart from this marketing site. Sign-in will use your Mukoko Account: the API side is built, the app side is not.',
    issues: [83],
  },
  {
    state: 'planned',
    title: 'Shamwari CLI',
    body: 'Shamwari in your terminal, for people who work there. Not built yet.',
  },
  {
    state: 'planned',
    title: 'Shamwari MCP server',
    body: 'Connect Shamwari’s cited Zimbabwean law and tax to your own agents and tools. Not built yet.',
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
