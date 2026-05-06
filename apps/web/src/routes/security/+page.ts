import { buildMeta } from "$lib/seo/meta";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ url }) => ({
  meta: buildMeta({
    pathname: url.pathname,
    title: "Security",
    description:
      "How Shamwari AI handles encryption, model isolation, and responsible disclosure. Includes our security.txt contact.",
  }),
});
