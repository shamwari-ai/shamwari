/**
 * Per-page SEO metadata for platform.shamwari.ai. The platform is a
 * developer portal; default is noindex until launch.
 */

export const SITE = {
  url: "https://platform.shamwari.ai",
  name: "Shamwari AI Platform",
  brand: "Shamwari AI Platform",
  defaultDescription:
    "Developer and business portal for Shamwari AI — API keys, usage dashboards, billing, and documentation.",
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
}

interface BuildMetaInput {
  title?: string;
  description?: string;
  pathname: string;
  ogImage?: string;
  ogType?: "website" | "article";
  noindex?: boolean;
}

/** Default for the platform is noindex until the public surface ships. */
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
    noindex: input.noindex ?? true,
  };
}
