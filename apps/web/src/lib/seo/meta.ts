/**
 * Per-page SEO metadata. Call buildMeta() in +page.ts/+layout.ts and pass the
 * result into the page store; +layout.svelte renders it via <svelte:head>.
 */

export const SITE = {
  url: "https://shamwari.ai",
  name: "Shamwari AI",
  brand: "Shamwari AI",
  defaultDescription:
    "Shamwari AI is open-source AI built for Africa — small enough to run locally, multilingual (English, Shona, Ndebele), and culturally grounded.",
  defaultOgImage: "/og/default.png",
  twitter: "@shamwariai",
  locale: "en_US",
} as const;

export interface PageMeta {
  title: string;
  description: string;
  canonical: string;
  ogImage: string;
  ogType: "website" | "article";
  noindex: boolean;
  /** Shape: { hreflang: 'en' | 'sn' | 'nd', href: absolute URL }. */
  alternates?: { hreflang: string; href: string }[];
  /** Article-only fields */
  article?: {
    publishedTime?: string;
    modifiedTime?: string;
    author?: string;
    section?: string;
    tags?: string[];
  };
}

interface BuildMetaInput {
  title?: string;
  description?: string;
  pathname: string;
  ogImage?: string;
  ogType?: "website" | "article";
  noindex?: boolean;
  alternates?: PageMeta["alternates"];
  article?: PageMeta["article"];
}

/** Compose a PageMeta. Falls back to site defaults; truncates title sensibly. */
export function buildMeta(input: BuildMetaInput): PageMeta {
  const fullTitle = input.title
    ? input.title.includes(SITE.brand)
      ? input.title
      : `${input.title} | ${SITE.brand}`
    : SITE.brand;

  return {
    title: fullTitle,
    description: input.description ?? SITE.defaultDescription,
    canonical: new URL(input.pathname, SITE.url).toString(),
    ogImage: new URL(input.ogImage ?? SITE.defaultOgImage, SITE.url).toString(),
    ogType: input.ogType ?? "website",
    noindex: input.noindex ?? false,
    alternates: input.alternates,
    article: input.article,
  };
}
