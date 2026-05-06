/**
 * Site-wide JSON-LD builders. Composes the framework-agnostic helpers from
 * @shamwari/ui with Shamwari-specific defaults so every page can drop in
 * the right schema without duplicating values.
 */

import {
  buildOrganization,
  buildSoftwareApplication,
  buildWebSite,
  type JsonLdObject,
} from "@shamwari/ui/lib/jsonld";
import { SITE } from "./meta";

const NYUCHI = {
  name: "Nyuchi Africa",
  url: "https://nyuchi.africa",
  description:
    "Zimbabwean tech company building open source, community-based platforms for Africa.",
};

export function shamwariOrganization(): JsonLdObject {
  return {
    ...buildOrganization({
      name: SITE.brand,
      url: SITE.url,
      logo: `${SITE.url}/icon.svg`,
      description: SITE.defaultDescription,
      founder: { name: "Bryan Fawcett" },
      sameAs: [
        "https://github.com/nyuchitech/shamwari-ai",
        "https://huggingface.co/nyuchi",
        "https://nyuchi.africa",
      ],
    }),
    parentOrganization: {
      "@type": "Organization",
      ...NYUCHI,
    },
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: "support@shamwari.ai",
      areaServed: "Worldwide",
      availableLanguage: ["English", "Shona", "Ndebele"],
    },
  };
}

export function shamwariWebSite(): JsonLdObject {
  return {
    ...buildWebSite({
      name: SITE.brand,
      url: SITE.url,
      description: SITE.defaultDescription,
      publisher: { name: NYUCHI.name, url: NYUCHI.url },
      inLanguage: ["en", "sn", "nd"],
    }),
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: `${SITE.url}/search?q={search_term_string}`,
      },
      "query-input": "required name=search_term_string",
    },
  };
}

export function shamwariSoftwareApplication(): JsonLdObject {
  return {
    ...buildSoftwareApplication({
      name: SITE.brand,
      url: SITE.url,
      description: SITE.defaultDescription,
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web, Android, iOS",
      inLanguage: ["en", "sn", "nd"],
      provider: NYUCHI,
      offers: [
        {
          name: "Free",
          price: 0,
          priceCurrency: "USD",
          description: "Free tier with rate-limited chat access.",
        },
        {
          name: "Developer",
          price: 19,
          priceCurrency: "USD",
          description: "Higher rate limits and API access for builders.",
        },
      ],
    }),
    aggregateRating: undefined,
  };
}

export function breadcrumb(
  items: { name: string; url: string }[],
): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function faqPage(
  items: { question: string; answer: string }[],
): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}

export function article(input: {
  headline: string;
  description: string;
  url: string;
  datePublished: string;
  dateModified?: string;
  authorName: string;
  authorUrl?: string;
  image?: string;
}): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.headline,
    description: input.description,
    url: input.url,
    datePublished: input.datePublished,
    dateModified: input.dateModified ?? input.datePublished,
    author: {
      "@type": "Person",
      name: input.authorName,
      ...(input.authorUrl && { url: input.authorUrl }),
    },
    publisher: {
      "@type": "Organization",
      name: SITE.brand,
      url: SITE.url,
      logo: {
        "@type": "ImageObject",
        url: `${SITE.url}/icon.svg`,
      },
    },
    ...(input.image && { image: input.image }),
  };
}

export function techArticle(input: {
  headline: string;
  description: string;
  url: string;
  datePublished: string;
  dateModified?: string;
  proficiencyLevel?: "Beginner" | "Intermediate" | "Expert";
}): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: input.headline,
    description: input.description,
    url: input.url,
    datePublished: input.datePublished,
    dateModified: input.dateModified ?? input.datePublished,
    proficiencyLevel: input.proficiencyLevel ?? "Beginner",
    publisher: {
      "@type": "Organization",
      name: SITE.brand,
      url: SITE.url,
    },
  };
}
