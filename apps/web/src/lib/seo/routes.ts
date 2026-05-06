/**
 * Static route registry — used by the sitemap endpoint and llms.txt.
 * Add new public marketing/docs routes here so they're discoverable by
 * search engines and answer engines.
 */

export interface SiteRoute {
  path: string;
  /** ISO date string for lastmod */
  lastmod: string;
  changefreq: "daily" | "weekly" | "monthly" | "yearly";
  priority: number;
  /** One-line summary, used by llms.txt */
  summary: string;
}

export const routes: SiteRoute[] = [
  {
    path: "/",
    lastmod: "2026-05-06",
    changefreq: "weekly",
    priority: 1.0,
    summary: "Shamwari AI — open-source AI built for Africa.",
  },
  {
    path: "/about",
    lastmod: "2026-05-06",
    changefreq: "monthly",
    priority: 0.8,
    summary:
      "Who builds Shamwari AI, why a small model, and why Africa-first.",
  },
  {
    path: "/pricing",
    lastmod: "2026-05-06",
    changefreq: "monthly",
    priority: 0.9,
    summary: "Pricing tiers — free, developer, and self-hosted plans.",
  },
  {
    path: "/faq",
    lastmod: "2026-05-06",
    changefreq: "monthly",
    priority: 0.7,
    summary:
      "Answers to common questions about Shamwari AI, languages, pricing, and self-hosting.",
  },
  {
    path: "/docs",
    lastmod: "2026-05-06",
    changefreq: "weekly",
    priority: 0.8,
    summary: "Developer documentation — quickstart, authentication, chat API.",
  },
  {
    path: "/docs/quickstart",
    lastmod: "2026-05-06",
    changefreq: "monthly",
    priority: 0.7,
    summary: "Send your first chat completion in under five minutes.",
  },
  {
    path: "/blog",
    lastmod: "2026-05-06",
    changefreq: "weekly",
    priority: 0.6,
    summary: "Updates from the Shamwari AI team.",
  },
  {
    path: "/blog/hello-shamwari",
    lastmod: "2026-05-06",
    changefreq: "yearly",
    priority: 0.5,
    summary: "Introducing Shamwari AI — open-source AI built for Africa.",
  },
  {
    path: "/security",
    lastmod: "2026-05-06",
    changefreq: "monthly",
    priority: 0.6,
    summary: "How Shamwari AI handles data, encryption, and disclosures.",
  },
  {
    path: "/privacy",
    lastmod: "2026-05-06",
    changefreq: "yearly",
    priority: 0.5,
    summary: "Privacy policy covering data collected, retention, and rights.",
  },
  {
    path: "/terms",
    lastmod: "2026-05-06",
    changefreq: "yearly",
    priority: 0.5,
    summary: "Terms of service for using Shamwari AI.",
  },
];
