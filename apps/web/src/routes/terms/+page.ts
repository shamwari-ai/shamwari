import { buildMeta } from "$lib/seo/meta";
import type { PageLoad } from "./$types";

export const load: PageLoad = ({ url }) => ({
  meta: buildMeta({
    pathname: url.pathname,
    title: "Terms of service",
    description:
      "The rules for using Shamwari AI — acceptable use, the MIT licence covering the open-source code, API limits, and governing law.",
  }),
});
