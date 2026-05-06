/**
 * Site-wide JSON-LD for the platform. Mirrors web's brand entity so
 * answer engines see consistent Organization metadata across both.
 */

import {
  buildOrganization,
  buildWebSite,
  type JsonLdObject,
} from "@shamwari/ui/lib/jsonld";
import { SITE } from "./meta";

const NYUCHI = {
  name: "Nyuchi Africa",
  url: "https://nyuchi.africa",
};

export function platformOrganization(): JsonLdObject {
  return buildOrganization({
    name: "Shamwari AI",
    url: "https://shamwari.ai",
    logo: "https://shamwari.ai/icon.svg",
    description:
      "Open-source AI built for Africa — small enough to run locally, multilingual (English, Shona, Ndebele).",
    founder: { name: "Bryan Fawcett" },
    sameAs: [
      "https://github.com/nyuchitech/shamwari-ai",
      "https://huggingface.co/nyuchi",
      "https://nyuchi.africa",
    ],
  });
}

export function platformWebSite(): JsonLdObject {
  return buildWebSite({
    name: SITE.brand,
    url: SITE.url,
    description: SITE.defaultDescription,
    publisher: { name: NYUCHI.name, url: NYUCHI.url },
    inLanguage: ["en"],
  });
}
