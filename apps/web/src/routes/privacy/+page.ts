import { buildMeta } from "$lib/seo/meta";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ url }) => ({
  meta: buildMeta({
    pathname: url.pathname,
    title: "Privacy policy",
    description:
      "How Shamwari AI collects, uses, and protects your data. Plain-language summary of rights under Zimbabwe's Data Protection Act and GDPR.",
  }),
});
