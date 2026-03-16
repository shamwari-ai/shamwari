/**
 * Shared JSON-LD structured data utilities for Schema.org compliance.
 *
 * Provides a React component for rendering JSON-LD scripts and type-safe
 * builder functions for Schema.org types used across Shamwari AI properties.
 */

import type { ReactElement } from "react";

// --- Core Types ---

/** Base JSON-LD object with required Schema.org context and type. */
export interface JsonLdObject {
  "@context": "https://schema.org";
  "@type": string;
  [key: string]: unknown;
}

// --- React Component ---

/**
 * Renders a `<script type="application/ld+json">` tag with the given JSON-LD data.
 * Place inside `<body>` in Next.js layouts to avoid `<head>` management conflicts.
 */
export function JsonLd({ data }: { data: JsonLdObject }): ReactElement {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

// --- Builder Functions ---

export interface OrganizationData {
  name: string;
  url: string;
  logo?: string;
  description?: string;
  foundingDate?: string;
  founder?: { name: string; "@type"?: string };
  sameAs?: string[];
}

export function buildOrganization(data: OrganizationData): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: data.name,
    url: data.url,
    ...(data.logo && { logo: data.logo }),
    ...(data.description && { description: data.description }),
    ...(data.foundingDate && { foundingDate: data.foundingDate }),
    ...(data.founder && {
      founder: { "@type": "Person", ...data.founder },
    }),
    ...(data.sameAs && { sameAs: data.sameAs }),
  };
}

export interface WebApplicationData {
  name: string;
  url: string;
  description?: string;
  applicationCategory?: string;
  operatingSystem?: string;
  inLanguage?: string[];
  provider?: OrganizationData;
  offers?: OfferData[];
}

export function buildWebApplication(data: WebApplicationData): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: data.name,
    url: data.url,
    ...(data.description && { description: data.description }),
    ...(data.applicationCategory && {
      applicationCategory: data.applicationCategory,
    }),
    ...(data.operatingSystem && { operatingSystem: data.operatingSystem }),
    ...(data.inLanguage && { inLanguage: data.inLanguage }),
    ...(data.provider && {
      provider: {
        "@type": "Organization",
        name: data.provider.name,
        url: data.provider.url,
      },
    }),
    ...(data.offers && {
      offers: data.offers.map((o) => buildOffer(o)),
    }),
  };
}

export interface WebSiteData {
  name: string;
  url: string;
  description?: string;
  publisher?: { name: string; url: string };
  inLanguage?: string[];
}

export function buildWebSite(data: WebSiteData): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: data.name,
    url: data.url,
    ...(data.description && { description: data.description }),
    ...(data.publisher && {
      publisher: {
        "@type": "Organization",
        name: data.publisher.name,
        url: data.publisher.url,
      },
    }),
    ...(data.inLanguage && { inLanguage: data.inLanguage }),
  };
}

export interface SoftwareApplicationData {
  name: string;
  url?: string;
  description?: string;
  applicationCategory?: string;
  operatingSystem?: string;
  softwareVersion?: string;
  inLanguage?: string[];
  provider?: { name: string; url: string };
  offers?: OfferData[];
}

export function buildSoftwareApplication(
  data: SoftwareApplicationData,
): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: data.name,
    ...(data.url && { url: data.url }),
    ...(data.description && { description: data.description }),
    ...(data.applicationCategory && {
      applicationCategory: data.applicationCategory,
    }),
    ...(data.operatingSystem && { operatingSystem: data.operatingSystem }),
    ...(data.softwareVersion && { softwareVersion: data.softwareVersion }),
    ...(data.inLanguage && { inLanguage: data.inLanguage }),
    ...(data.provider && {
      provider: {
        "@type": "Organization",
        name: data.provider.name,
        url: data.provider.url,
      },
    }),
    ...(data.offers && {
      offers: data.offers.map((o) => buildOffer(o)),
    }),
  };
}

export interface OfferData {
  name?: string;
  price: string | number;
  priceCurrency: string;
  description?: string;
  eligibleQuantity?: { value: number; unitText: string };
}

export function buildOffer(
  data: OfferData,
): Omit<JsonLdObject, "@context"> & { "@type": "Offer" } {
  return {
    "@context": "https://schema.org",
    "@type": "Offer" as const,
    ...(data.name && { name: data.name }),
    price: String(data.price),
    priceCurrency: data.priceCurrency,
    ...(data.description && { description: data.description }),
    ...(data.eligibleQuantity && {
      eligibleQuantity: {
        "@type": "QuantitativeValue",
        value: data.eligibleQuantity.value,
        unitText: data.eligibleQuantity.unitText,
      },
    }),
  };
}

export interface DatasetData {
  name: string;
  description?: string;
  url?: string;
  inLanguage?: string;
  encodingFormat?: string;
  creator?: { name: string; url: string };
  license?: string;
  distribution?: { contentUrl: string; encodingFormat: string };
}

export function buildDataset(data: DatasetData): JsonLdObject {
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: data.name,
    ...(data.description && { description: data.description }),
    ...(data.url && { url: data.url }),
    ...(data.inLanguage && { inLanguage: data.inLanguage }),
    ...(data.encodingFormat && { encodingFormat: data.encodingFormat }),
    ...(data.creator && {
      creator: {
        "@type": "Organization",
        name: data.creator.name,
        url: data.creator.url,
      },
    }),
    ...(data.license && { license: data.license }),
    ...(data.distribution && {
      distribution: {
        "@type": "DataDownload",
        contentUrl: data.distribution.contentUrl,
        encodingFormat: data.distribution.encodingFormat,
      },
    }),
  };
}
